package com.ikerlorente11.reproductor.host

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * YouTube Music: a song one does not have, played straight from it, without downloading it nor any server (the same as
 * the desktop's src-tauri/src/yt.rs). `/host/yt/q?artist=…&title=…&d=<seconds>`: found on YouTube Music (its «songs»),
 * its audio's address asked for (YouTube's own API, as yt-dlp's visionOS client does, with a visitor's data and cookies
 * taken once from a video's page) and the audio relayed by pieces. ExoPlayer plays it from here, so it goes on with the
 * screen off; the page measures it from here too (its loudness, its silences).
 *
 * What is found is kept while the app runs: each song's video and its audio's address (until a little before it
 * expires). So a song sounds at once, the page has the songs it shows prepared beforehand (`prepare`): found, their
 * address asked for and their first piece fetched and kept (YouTube is slow to give a song's first bytes the first time).
 */
class Yt(private val client: OkHttpClient) {
    private class Session(val visitor: String, val cookies: String, val made: Long)
    private class Audio(val url: String, val until: Long)
    /** a song's first piece, fetched beforehand (ExoPlayer starts with it and asks for the rest right after) */
    private class First(val bytes: ByteArray, val total: Long, val mime: String)
    /** what the page gets: the piece of the audio, and how to answer it */
    class Piece(val status: Int, val mime: String, val stream: InputStream, val length: Long, val contentRange: String?)

    @Volatile private var session: Session? = null
    /** «artist\ntitle» → its video ("" : not found) */
    private val found = ConcurrentHashMap<String, String>()
    private val audio = ConcurrentHashMap<String, Audio>()
    /** each prepared song's first piece, the oldest first (only the last FIRST_KEPT are kept) */
    private val first = object : LinkedHashMap<String, First>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, First>?) = size > FIRST_KEPT
    }
    private val preparing: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val pool = Executors.newFixedThreadPool(PREPARING_AT_ONCE)

    /** The visitor's data and cookies of a first visit (once an hour, or when YouTube asks again). */
    @Synchronized
    private fun session(fresh: Boolean): Session {
        session?.takeIf { !fresh && System.currentTimeMillis() - it.made < SESSION_MS }?.let { return it }
        val t = System.currentTimeMillis()
        client.newCall(Request.Builder().url(FIRST_VISIT).header("User-Agent", VISION_UA).header("Accept-Language", "es-ES,es;q=0.9").build()).execute().use { res ->
            val cookies = res.headers("Set-Cookie").joinToString("; ") { it.substringBefore(';') }
            val html = res.body?.string() ?: ""
            val visitor = html.substringAfter("\"VISITOR_DATA\":\"", "").substringBefore('"')
            if (visitor.isEmpty()) throw IllegalStateException("YouTube no dio datos de visitante")
            Log.i(TAG, "yt: visita ${System.currentTimeMillis() - t} ms")
            return Session(visitor, cookies, System.currentTimeMillis()).also { session = it }
        }
    }

    private fun post(url: String, body: JSONObject, headers: Map<String, String> = emptyMap()): JSONObject {
        val request = Request.Builder().url(url).post(body.toString().toRequestBody(JSON))
        headers.forEach { (k, v) -> request.header(k, v) }
        client.newCall(request.build()).execute().use { res -> return JSONObject(res.body?.string() ?: "{}") }
    }

    private fun text(o: JSONObject?): String {
        val runs = o?.optJSONArray("runs") ?: return ""
        return (0 until runs.length()).joinToString("") { runs.optJSONObject(it)?.optString("text") ?: "" }
    }
    private fun plain(s: String) = s.lowercase().filter { it.isLetterOrDigit() }
    private fun seconds(s: String) = s.split(':').fold(0L) { acc, p -> acc * 60 + (p.trim().toLongOrNull() ?: 0) }

    private class Hit(val id: String, val title: String, val meta: String, val length: Long)

    /** YouTube Music's first songs for a search: their video, title, «Artist • Album • 3:25» and length. */
    private fun songsFor(query: String): List<Hit> {
        val data = post("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", JSONObject()
            .put("context", JSONObject().put("client", JSONObject().put("clientName", "WEB_REMIX").put("clientVersion", "1.20251119.01.00").put("hl", "es").put("gl", "ES")))
            .put("query", query).put("params", SONGS_ONLY))
        val hits = mutableListOf<Hit>()
        val shelves = data.optJSONObject("contents")?.optJSONObject("tabbedSearchResultsRenderer")?.optJSONArray("tabs")?.optJSONObject(0)
            ?.optJSONObject("tabRenderer")?.optJSONObject("content")?.optJSONObject("sectionListRenderer")?.optJSONArray("contents") ?: JSONArray()
        for (i in 0 until shelves.length()) {
            val items = shelves.optJSONObject(i)?.optJSONObject("musicShelfRenderer")?.optJSONArray("contents") ?: continue
            for (j in 0 until items.length()) {
                val r = items.optJSONObject(j)?.optJSONObject("musicResponsiveListItemRenderer") ?: continue
                val id = r.optJSONObject("playlistItemData")?.optString("videoId")?.takeIf { it.isNotEmpty() } ?: continue
                val cols = r.optJSONArray("flexColumns") ?: JSONArray()
                val col = { k: Int -> text(cols.optJSONObject(k)?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text")) }
                val meta = col(1)
                hits.add(Hit(id, col(0), meta, seconds(meta.substringAfterLast(" • "))))
            }
        }
        return hits
    }

    /** The song's video: by its ISRC (the recording's own code: that very version) if a result as long comes; else,
     *  among the first songs for «artist title», the one most alike (its artist, its title, its length). */
    fun search(artist: String, title: String, duration: Long, isrc: String = ""): String {
        val key = "$artist\n$title\n$isrc"
        found[key]?.let { return it.ifEmpty { throw NotFound() } }
        val t = System.currentTimeMillis()
        val close = { length: Long, by: Long -> duration == 0L || length == 0L || kotlin.math.abs(length - duration) <= by }
        var best: String? = null
        var how = ""
        if (isrc.isNotEmpty()) {
            best = try { songsFor(isrc).take(3).firstOrNull { close(it.length, 5) }?.id } catch (_: Exception) { null }
            how = "ISRC"
        }
        if (best == null) {
            val hits = songsFor("$artist $title")
            val wantedArtist = plain(artist)
            val wantedTitle = plain(title)
            fun score(h: Hit): Int {
                var n = 0
                if (plain(h.meta).contains(wantedArtist)) n += 2
                val found = plain(h.title)
                if (found.isNotEmpty() && (found.contains(wantedTitle) || wantedTitle.contains(found))) n += 2
                if (duration > 0 && h.length > 0) n += when (kotlin.math.abs(h.length - duration)) { in 0..3 -> 2; in 4..8 -> 1; else -> 0 }
                return n
            }
            // the most alike of the first five (the first of them on a tie)
            best = hits.take(5).withIndex().maxWithOrNull(compareBy({ score(it.value) }, { -it.index }))?.value?.id
            how = "artista y título"
        }
        Log.i(TAG, "yt: buscar «$artist – $title» ($how) ${System.currentTimeMillis() - t} ms → ${best ?: "nada"}")
        found[key] = best ?: ""
        return best ?: throw NotFound()
    }

    /** The video's audio (opus, the best; `m4a`: AAC in MP4, to keep it as a file): its address, kept until a little
     *  before it expires. */
    fun audioOf(video: String, m4a: Boolean = false): String {
        val key = if (m4a) "$video/m4a" else video
        audio[key]?.takeIf { System.currentTimeMillis() < it.until }?.let { return it.url }
        for (retry in listOf(false, true)) {
            val s = session(retry)
            val t = System.currentTimeMillis()
            val data = post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", JSONObject()
                .put("context", JSONObject().put("client", JSONObject().put("clientName", "VISIONOS").put("clientVersion", "1.02").put("deviceMake", "Apple")
                    .put("deviceModel", "RealityDevice17,1").put("userAgent", VISION_UA).put("osName", "visionOS").put("osVersion", "26.5.23O471")
                    .put("hl", "es").put("gl", "ES").put("visitorData", s.visitor)))
                .put("videoId", video).put("contentCheckOk", true).put("racyCheckOk", true),
                mapOf("User-Agent" to VISION_UA, "X-YouTube-Client-Name" to "101", "X-YouTube-Client-Version" to "1.02",
                      "X-Goog-Visitor-Id" to s.visitor, "Cookie" to s.cookies))
            val playability = data.optJSONObject("playabilityStatus")
            val status = playability?.optString("status") ?: ""
            if (status != "OK") {
                Log.i(TAG, "yt: audio $video ${System.currentTimeMillis() - t} ms: $status ${playability?.optString("reason")}")
                // asked to sign in (a visit too old, or seen as a bot): once more with a new visit
                if (status == "LOGIN_REQUIRED" && !retry) continue
                throw IllegalStateException("YouTube no la da: ${playability?.optString("reason")?.ifEmpty { status } ?: status}")
            }
            val sd = data.optJSONObject("streamingData") ?: throw IllegalStateException("YouTube no dio su audio")
            val formats = sd.optJSONArray("adaptiveFormats") ?: JSONArray()
            val audios = (0 until formats.length()).mapNotNull { formats.optJSONObject(it) }
                .filter { it.optString("mimeType").startsWith(if (m4a) "audio/mp4" else "audio/") && it.has("url") }
                .sortedWith(compareBy({ !m4a && !it.optString("mimeType").contains("opus") }, { -it.optLong("bitrate") }))
            val f = audios.firstOrNull() ?: throw IllegalStateException("YouTube no dio su audio")
            val expires = sd.optString("expiresInSeconds").toLongOrNull() ?: 3600
            Log.i(TAG, "yt: audio $video ${System.currentTimeMillis() - t} ms (itag ${f.optInt("itag")}, ${f.optLong("bitrate") / 1000} kbps)")
            audio[key] = Audio(f.getString("url"), System.currentTimeMillis() + (expires - 600) * 1000)
            return f.getString("url")
        }
        throw IllegalStateException("YouTube no la da")
    }

    /** The piece of the song's audio asked for (`range`: the player's Range header). Its start, if prepared, at once. */
    fun piece(artist: String, title: String, duration: Long, isrc: String, range: String?): Piece {
        val t = System.currentTimeMillis()
        val video = search(artist, title, duration, isrc)
        val asked = range?.trim() ?: "bytes=0-"
        val prepared = synchronized(first) { first[video] }
        if (prepared != null && asked.startsWith("bytes=0-")) {
            Log.i(TAG, "yt: principio de $video ya preparado ($asked)")
            return Piece(206, prepared.mime, ByteArrayInputStream(prepared.bytes), prepared.bytes.size.toLong(), "bytes 0-${prepared.bytes.size - 1}/${prepared.total}")
        }
        val url = audioOf(video)
        val res = client.newCall(Request.Builder().url(url).header("User-Agent", VISION_UA).header("Range", limit(asked)).build()).execute()
        Log.i(TAG, "yt: trozo $asked de $video: respuesta en ${System.currentTimeMillis() - t} ms")
        if (!res.isSuccessful) {
            // the address no longer serves (expired early): forgotten, so the next piece asks for another
            audio.remove(video)
            val code = res.code
            res.close()
            throw IllegalStateException("el audio respondió $code")
        }
        val body = res.body!!
        return Piece(res.code, res.header("Content-Type") ?: "audio/webm", body.byteStream(), body.contentLength(), res.header("Content-Range"))
    }

    /** The video's whole audio (AAC in MP4) into `to`, piece after piece (Dl: downloading to the phone). */
    fun download(video: String, to: File) {
        var start = 0L
        var total = -1L
        var again = true
        to.outputStream().use { out ->
            while (total < 0 || start < total) {
                val url = audioOf(video, true)
                val res = client.newCall(Request.Builder().url(url).header("User-Agent", VISION_UA).header("Range", "bytes=$start-${start + PIECE - 1}").build()).execute()
                res.use {
                    if (!res.isSuccessful) {
                        // the address stopped serving: once more with a new one
                        audio.remove("$video/m4a")
                        if (again) { again = false; return@use }
                        throw IllegalStateException("el audio respondió ${res.code}")
                    }
                    total = res.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: (start + (res.body?.contentLength() ?: 0))
                    val n = res.body!!.byteStream().copyTo(out)
                    if (n <= 0L) throw IllegalStateException("el audio llegó vacío")
                    start += n
                }
            }
        }
    }

    /** What the player asked, cut to PIECE bytes (YouTube serves a song by pieces). */
    private fun limit(asked: String): String {
        val spec = asked.removePrefix("bytes=").substringBefore(',')
        val start = spec.substringBefore('-').toLongOrNull() ?: return "bytes=0-${PIECE - 1}"
        val end = spec.substringAfter('-', "").toLongOrNull()
        return "bytes=$start-${minOf(end ?: Long.MAX_VALUE, start + PIECE - 1)}"
    }

    /** Prepares the songs the page shows (`[{artist, title, d}]`, the first ones first), a few at once. */
    fun prepare(songs: JSONArray) {
        for (i in 0 until minOf(songs.length(), 30)) {
            val o = songs.optJSONObject(i) ?: continue
            val artist = o.optString("artist")
            val title = o.optString("title")
            val key = "$artist\n$title"
            if (!preparing.add(key)) continue
            pool.execute {
                try {
                    val video = search(artist, title, o.optDouble("d", 0.0).toLong(), o.optString("isrc"))
                    if (synchronized(first) { first.containsKey(video) }) return@execute
                    val url = audioOf(video)
                    val t = System.currentTimeMillis()
                    client.newCall(Request.Builder().url(url).header("User-Agent", VISION_UA).header("Range", "bytes=0-${FIRST_PIECE - 1}").build()).execute().use { res ->
                        val total = res.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: 0
                        val bytes = res.body?.bytes() ?: return@execute
                        synchronized(first) { first[video] = First(bytes, total, res.header("Content-Type") ?: "audio/webm") }
                        Log.i(TAG, "yt: preparada $video (${bytes.size / 1024} KB en ${System.currentTimeMillis() - t} ms)")
                    }
                } catch (e: Exception) {
                    Log.i(TAG, "yt: no se pudo preparar «$artist – $title»: ${e.message}")
                } finally {
                    preparing.remove(key)
                }
            }
        }
    }

    class NotFound : Exception("no está en YouTube Music")

    companion object {
        private const val TAG = "reproductor"
        /** YouTube's visionOS client (yt-dlp's `visionos`): it gives the audio's address without a JS player nor a PO token */
        private const val VISION_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
        private const val FIRST_VISIT = "https://www.youtube.com/watch?v=KUZ7jG7BKE8"
        /** YouTube Music's search, only songs */
        private const val SONGS_ONLY = "EgWKAQIIAWoKEAkQBRAKEAMQBA=="
        private const val SESSION_MS = 3_600_000L
        private const val PIECE = 4L shl 20
        private const val FIRST_PIECE = 256L shl 10
        private const val FIRST_KEPT = 60
        private const val PREPARING_AT_ONCE = 3
        private val JSON = "application/json".toMediaType()
    }
}
