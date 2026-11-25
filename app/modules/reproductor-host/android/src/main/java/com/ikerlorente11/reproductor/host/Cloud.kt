package com.ikerlorente11.reproductor.host

import android.util.Base64
import android.util.Xml
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.io.IOException
import java.net.URLDecoder
import java.util.ArrayDeque
import java.util.concurrent.TimeUnit

/**
 * The cloud of a server of El Reproductor (its OpenCloud, by WebDAV with the app password), as the desktop's
 * cloud.rs: its folders listed for the pages, a song deleted, a song played (`/w/<path>`, by ranges: the player asks
 * for the pieces it needs) and songs kept on this device (copied into the app's music folder with the cloud's own
 * folders, played from there; see [Settings.musicDir]). The page tells it where the cloud is on connecting
 * (`PUT /host/cloud`): it is kept in memory only, the password with the page's secrets.
 */
class Cloud(private val settings: Settings, private val events: Events) {
    private class Conn(val webdav: String, val auth: String)

    @Volatile private var conn: Conn? = null
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()
    private val copies = client.newBuilder().readTimeout(10, TimeUnit.MINUTES).build()

    fun set(body: JSONObject) {
        val webdav = body.optString("webdav").trim().trimEnd('/')
        val user = body.optString("user")
        val password = body.optString("password")
        conn = if (webdav.isEmpty() || user.isEmpty() || password.isEmpty()) null
            else Conn(webdav, "Basic " + Base64.encodeToString("$user:$password".toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
    }

    private fun need(): Conn = conn ?: throw IllegalStateException("sin servidor conectado")

    private fun urlOf(c: Conn, path: String) = c.webdav + encodePath("/" + path.trimStart('/'))

    /** The folders and songs of a folder: `{ folders, files }` of `{ path, name, size }`; a 404 when it is not there. */
    fun list(dir: String): JSONObject {
        val c = need()
        val body = """<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>"""
        val request = Request.Builder().url(urlOf(c, dir.trimEnd('/') + "/")).header("Authorization", c.auth).header("Depth", "1")
            .method("PROPFIND", body.toRequestBody("application/xml".toMediaType())).build()
        val text = client.newCall(request).execute().use { res ->
            when {
                res.code == 404 -> throw NotFound()
                res.code == 401 -> throw IllegalStateException("la nube no acepta tu contraseña de aplicación")
                !res.isSuccessful -> throw IllegalStateException("la nube respondió ${res.code}")
            }
            res.body?.string() ?: ""
        }
        // the path part of the WebDAV root: the hrefs start with it
        val prefix = decode(c.webdav.split('/', limit = 4).getOrNull(3)?.let { "/$it" } ?: "")
        val base = "/" + dir.trim('/')
        val folders = JSONArray()
        val files = JSONArray()
        for ((href, folder, size) in parse(text).drop(1)) {
            val rel = href.removePrefix(prefix).trimEnd('/')
            val name = rel.substringAfterLast('/')
            if (name.isEmpty()) continue
            val entry = JSONObject().put("path", "${base.trimEnd('/')}/$name").put("name", name).put("size", size)
            if (folder) folders.put(entry) else files.put(entry)
        }
        return JSONObject().put("folders", folders).put("files", files)
    }

    fun remove(path: String) {
        val c = need()
        client.newCall(Request.Builder().url(urlOf(c, path)).header("Authorization", c.auth).delete().build()).execute().use { res ->
            if (res.code == 404) throw NotFound()
            if (!res.isSuccessful) throw IllegalStateException("la nube respondió ${res.code}")
        }
    }

    /** A song of the cloud as the player asks for it (`Range` passed on), or its copy on this device. */
    fun open(path: String, range: String?): Pair<File?, Response?> {
        local(path)?.takeIf { it.isFile }?.let { return it to null }
        val c = need()
        val request = Request.Builder().url(urlOf(c, path)).header("Authorization", c.auth)
        if (!range.isNullOrBlank()) request.header("Range", range)
        return null to client.newCall(request.build()).execute()
    }

    // ---- songs of the cloud kept on this device ----
    /** Where the copy of a cloud path (`/Música/...`) goes, or null if it is not under the music. */
    fun local(path: String): File? {
        val rest = path.trimStart('/')
        val inner = when {
            rest == MUSIC_ROOT -> ""
            rest.startsWith("$MUSIC_ROOT/") -> rest.removePrefix("$MUSIC_ROOT/")
            else -> return null
        }
        var out = settings.musicDir()
        for (part in inner.split('/').filter { it.isNotEmpty() }) {
            if (part == ".." || part == "." || part.contains('\\')) return null
            out = File(out, part)
        }
        return out
    }

    fun have(paths: JSONArray): JSONArray {
        val out = JSONArray()
        for (i in 0 until paths.length()) { val p = paths.optString(i); if (local(p)?.isFile == true) out.put(p) }
        return out
    }

    private val queue = ArrayDeque<String>()
    private var done = 0
    private var total = 0
    private var running = false

    fun get(paths: JSONArray) {
        synchronized(queue) {
            for (i in 0 until paths.length()) {
                val p = paths.optString(i)
                if (p.isNotEmpty() && !queue.contains(p)) { queue.add(p); total++ }
            }
            if (running) return
            running = true
        }
        Thread({ copyQueue() }, "reproductor-copias").start()
    }

    private fun copyQueue() {
        while (true) {
            val path = synchronized(queue) {
                queue.poll() ?: run { done = 0; total = 0; running = false; null }
            } ?: return
            val error = try { copyOne(path); null } catch (e: Exception) { e.message ?: e.toString() }
            val (d, t) = synchronized(queue) { done++; done to total }
            events.send("offline-progress", JSONObject().put("done", d).put("total", t)
                .put("path", if (error == null) path else JSONObject.NULL)
                .put("error", if (error == null) JSONObject.NULL else "No se pudo guardar «${path.substringAfterLast('/')}»: $error"))
        }
    }

    private fun copyOne(path: String) {
        val target = local(path) ?: throw IllegalStateException("fuera de la música")
        if (target.isFile) return
        val c = need()
        copies.newCall(Request.Builder().url(urlOf(c, path)).header("Authorization", c.auth).build()).execute().use { res ->
            if (!res.isSuccessful) throw IllegalStateException("la nube respondió ${res.code}")
            target.parentFile?.mkdirs()
            val part = File(target.path + ".part")
            try {
                part.outputStream().use { out -> res.body!!.byteStream().copyTo(out, 256 * 1024) }
            } catch (e: IOException) { part.delete(); throw e }
            if (!part.renameTo(target)) { part.delete(); throw IllegalStateException("no se pudo dejar en su sitio") }
        }
    }

    fun forget(paths: JSONArray) {
        val root = settings.musicDir()
        for (i in 0 until paths.length()) {
            val file = local(paths.optString(i)) ?: continue
            if (file.isFile) file.delete()
            // the folders left empty go, up to the ones right inside the music folder (Artistas stays)
            var dir = file.parentFile
            while (dir != null && dir != root && dir.parentFile != root) {
                val left = dir.listFiles() ?: break
                if (left.any { it.isDirectory || Library.mimeOf(it.name).startsWith("audio/") } || !dir.deleteRecursively()) break
                dir = dir.parentFile
            }
        }
    }

    /** A folder or a file that is not there (the page wants `status: 404`). */
    class NotFound : Exception("404")

    companion object {
        const val MUSIC_ROOT = "Música"

        fun encodePath(path: String): String = path.split('/').joinToString("/") { seg ->
            buildString { for (b in seg.toByteArray(Charsets.UTF_8)) { val ch = b.toInt().toChar(); if (ch.isLetterOrDigit() && b >= 0 || ch in "-_.~") append(ch) else append("%%%02X".format(b.toInt() and 0xff)) } }
        }

        fun decode(text: String): String = try { URLDecoder.decode(text.replace("+", "%2B"), "UTF-8") } catch (_: Exception) { text }

        /** The answers of a PROPFIND: each one's href (decoded), whether it is a folder, its size. */
        fun parse(xml: String): List<Triple<String, Boolean, Long>> {
            val out = mutableListOf<Triple<String, Boolean, Long>>()
            val p = Xml.newPullParser()
            p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
            p.setInput(xml.reader())
            var href = StringBuilder(); var folder = false; var size = 0L; var field = ""
            while (true) {
                when (p.next()) {
                    XmlPullParser.START_TAG -> {
                        field = p.name
                        if (p.name == "response") { href = StringBuilder(); folder = false; size = 0 }
                        if (p.name == "collection") folder = true
                    }
                    XmlPullParser.TEXT -> when (field) {
                        "href" -> href.append(p.text)
                        "getcontentlength" -> size = p.text.trim().toLongOrNull() ?: 0L
                    }
                    XmlPullParser.END_TAG -> {
                        if (p.name == "response") out.add(Triple(decode(href.toString().trim()), folder, size))
                        field = ""
                    }
                    XmlPullParser.END_DOCUMENT -> return out
                }
            }
        }
    }
}
