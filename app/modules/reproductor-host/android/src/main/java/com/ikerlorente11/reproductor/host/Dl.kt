package com.ikerlorente11.reproductor.host

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer

/**
 * Downloading to this phone without a server (the page's pocket.ts asks for one song at a time, `POST /host/dl/song`):
 * the song found on YouTube Music (Yt), its audio (AAC in MP4: Android's own, with tags every app reads) brought whole,
 * put in a plain MP4 (YouTube gives it in fragments), tagged as Deezer says (title, artists, album, its number, year,
 * ISRC and the cover) and saved in the phone's music, `Music/El Reproductor/<artist>/<album>/`, where any music app
 * finds it, this one too. Its id in Android's index is how the page plays it (`/p/<id>`) and deletes it.
 */
class Dl(private val context: Context, private val client: OkHttpClient, private val yt: Yt) {
    private val collection get() =
        if (Build.VERSION.SDK_INT >= 29) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI

    /** Downloads one song (`PocketSong`); answers `{ path: "pocket:<id>" }`. */
    fun song(o: JSONObject): JSONObject {
        if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("Para descargar sin servidor hace falta Android 10 o más")
        val str = { k: String -> if (o.isNull(k)) "" else o.optString(k) }
        val artist = str("artist")
        val title = str("title")
        val t = System.currentTimeMillis()
        val video = yt.search(artist, title, o.optDouble("duration", 0.0).toLong(), str("isrc"))
        val dir = File(context.cacheDir, "dl").also { it.mkdirs() }
        val raw = File(dir, "$video.part")
        val plain = File(dir, "$video.m4a")
        try {
            yt.download(video, raw)
            remux(raw, plain)
            val cover = str("cover").takeIf { it.startsWith("http") }?.let { coverOf(it) }
            val udta = Mp4Tags.udta(title = title, artist = artist, albumArtist = str("albumArtist"), album = str("album"), year = str("year"),
                                    track = o.optInt("track"), tracks = o.optInt("tracks"), disc = o.optInt("disc", 1), isrc = str("isrc"), cover = cover)
            val bytes = Mp4Tags.write(plain.readBytes(), udta)
            val id = store(str("folder"), "${str("file").ifEmpty { title }}.m4a", bytes)
            Log.i(TAG, "dl: «$artist – $title» ${bytes.size / 1024} KB en ${System.currentTimeMillis() - t} ms")
            return JSONObject().put("path", "pocket:$id")
        } finally {
            raw.delete()
            plain.delete()
        }
    }

    /** Deletes songs it downloaded (`pocket:<id>`): to Android's bin (Android 11 and later, kept there 30 days), else
     *  gone; one already gone counts as deleted. */
    fun remove(paths: JSONArray) {
        for (i in 0 until paths.length()) {
            val id = paths.optString(i).removePrefix("pocket:").toLongOrNull() ?: continue
            val uri = ContentUris.withAppendedId(collection, id)
            try {
                if (Build.VERSION.SDK_INT >= 30) context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_TRASHED, 1) }, null, null)
                else context.contentResolver.delete(uri, null, null)
            } catch (e: Exception) { Log.w(TAG, "dl: no se pudo borrar $id", e) }
        }
    }

    /** A song it downloaded, to play it: its bytes, type and size. */
    fun file(id: String): Triple<InputStream, String, Long>? {
        val n = id.toLongOrNull() ?: return null
        val fd = try { context.contentResolver.openAssetFileDescriptor(ContentUris.withAppendedId(collection, n), "r") } catch (_: Exception) { null } ?: return null
        return Triple(fd.createInputStream(), "audio/mp4", fd.length)
    }

    /** The audio in a plain MP4 (one moov with every sample's place), as any app and Android's index read it best. */
    private fun remux(src: File, dst: File) {
        val ex = MediaExtractor()
        var mux: MediaMuxer? = null
        try {
            ex.setDataSource(src.path)
            val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: throw IllegalStateException("el audio no trae sonido")
            ex.selectTrack(track)
            val m = MediaMuxer(dst.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4).also { mux = it }
            val out = m.addTrack(ex.getTrackFormat(track))
            m.start()
            val buffer = ByteBuffer.allocate(1 shl 20)
            val info = MediaCodec.BufferInfo()
            while (true) {
                val n = ex.readSampleData(buffer, 0)
                if (n < 0) break
                info.set(0, n, ex.sampleTime, if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                m.writeSampleData(out, buffer, info)
                ex.advance()
            }
            m.stop()
        } finally {
            try { mux?.release() } catch (_: Exception) {}
            ex.release()
        }
    }

    private fun coverOf(url: String): ByteArray? = try {
        client.newCall(Request.Builder().url(url).build()).execute().use { res ->
            res.body?.takeIf { res.isSuccessful && it.contentLength() < COVER_MAX }?.bytes()
        }
    } catch (_: Exception) { null }

    /** Into the phone's music (the same file downloaded before, replaced); its id in Android's index. */
    private fun store(folder: String, name: String, bytes: ByteArray): Long {
        val resolver = context.contentResolver
        val relative = "${Environment.DIRECTORY_MUSIC}/El Reproductor/${folder.trim('/')}/"
        resolver.query(collection, arrayOf(MediaStore.Audio.Media._ID), "${MediaStore.Audio.Media.RELATIVE_PATH} = ? AND ${MediaStore.Audio.Media.DISPLAY_NAME} = ?",
                       arrayOf(relative, name), null)?.use { c ->
            while (c.moveToNext()) try { resolver.delete(ContentUris.withAppendedId(collection, c.getLong(0)), null, null) } catch (_: Exception) {}
        }
        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, name)
            put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4")
            put(MediaStore.Audio.Media.RELATIVE_PATH, relative)
            put(MediaStore.Audio.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values) ?: throw IllegalStateException("Android no dejó guardar la canción")
        try {
            resolver.openOutputStream(uri)!!.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Audio.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            try { resolver.delete(uri, null, null) } catch (_: Exception) {}
            throw e
        }
        return ContentUris.parseId(uri)
    }

    companion object {
        private const val TAG = "reproductor"
        private const val COVER_MAX = 3L shl 20
    }
}

/** An MP4's tags (iTunes' `moov/udta/meta/ilst`, what Android and every player read), written into the file. */
object Mp4Tags {
    private val L1 = Charsets.ISO_8859_1
    private val CONTAINERS = setOf("trak", "mdia", "minf", "stbl")

    private fun u32(n: Long) = byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte())
    private fun u16(n: Int) = byteArrayOf((n ushr 8).toByte(), n.toByte())
    private fun read32(b: ByteArray, at: Int): Long =
        ((b[at].toLong() and 0xff) shl 24) or ((b[at + 1].toLong() and 0xff) shl 16) or ((b[at + 2].toLong() and 0xff) shl 8) or (b[at + 3].toLong() and 0xff)
    private fun read64(b: ByteArray, at: Int): Long = (read32(b, at) shl 32) or read32(b, at + 4)
    private fun put32(b: ByteArray, at: Int, n: Long) = u32(n).copyInto(b, at)
    private fun put64(b: ByteArray, at: Int, n: Long) { put32(b, at, n ushr 32); put32(b, at + 4, n and 0xffffffffL) }

    fun box(type: String, vararg parts: ByteArray): ByteArray {
        val size = 8 + parts.sumOf { it.size }
        val out = ByteArrayOutputStream(size)
        out.write(u32(size.toLong()))
        out.write(type.toByteArray(L1))
        parts.forEach { out.write(it) }
        return out.toByteArray()
    }
    private fun data(kind: Int, value: ByteArray) = box("data", u32(kind.toLong()), u32(0), value)
    private fun text(type: String, value: String) = if (value.isEmpty()) ByteArray(0) else box(type, data(1, value.toByteArray(Charsets.UTF_8)))

    /** The `udta` box with the song's tags. */
    fun udta(title: String, artist: String, albumArtist: String, album: String, year: String, track: Int, tracks: Int, disc: Int,
             isrc: String, cover: ByteArray?): ByteArray {
        val items = listOf(
            text("©nam", title), text("©ART", artist), text("aART", albumArtist), text("©alb", album), text("©day", year),
            if (track > 0) box("trkn", data(0, u16(0) + u16(track) + u16(tracks) + u16(0))) else ByteArray(0),
            box("disk", data(0, u16(0) + u16(maxOf(disc, 1)) + u16(0))),
            if (isrc.isNotEmpty()) box("----", box("mean", u32(0), "com.apple.iTunes".toByteArray(L1)), box("name", u32(0), "ISRC".toByteArray(L1)),
                                       data(1, isrc.toByteArray(Charsets.UTF_8))) else ByteArray(0),
            // JPEG (13) or PNG (14)
            cover?.let { box("covr", data(if (it.size > 3 && it[0] == 0x89.toByte()) 14 else 13, it)) } ?: ByteArray(0)
        )
        val hdlr = box("hdlr", u32(0), u32(0), "mdir".toByteArray(L1), "appl".toByteArray(L1), u32(0), u32(0), byteArrayOf(0, 0))
        return box("udta", box("meta", u32(0), hdlr, box("ilst", *items.toTypedArray())))
    }

    private class Box(val type: String, val start: Int, val size: Int, val header: Int)
    private fun boxes(b: ByteArray, from: Int, to: Int): List<Box> {
        val out = mutableListOf<Box>()
        var p = from
        while (p + 8 <= to) {
            var size = read32(b, p)
            var header = 8
            if (size == 1L) { size = read64(b, p + 8); header = 16 } else if (size == 0L) size = (to - p).toLong()
            if (size < header || p + size > to) break
            out.add(Box(String(b, p + 4, 4, L1), p, size.toInt(), header))
            p += size.toInt()
        }
        return out
    }

    /** The file with `udta` in its moov (instead of the one it had); the samples' places moved if moov grew before them. */
    fun write(file: ByteArray, udta: ByteArray): ByteArray {
        val top = boxes(file, 0, file.size)
        val moov = top.firstOrNull { it.type == "moov" } ?: throw IllegalStateException("el MP4 no trae moov")
        val mdat = top.firstOrNull { it.type == "mdat" }
        val inner = ByteArrayOutputStream()
        for (c in boxes(file, moov.start + moov.header, moov.start + moov.size)) if (c.type != "udta") inner.write(file, c.start, c.size)
        inner.write(udta)
        val newMoov = box("moov", inner.toByteArray())
        val delta = (newMoov.size - moov.size).toLong()
        if (mdat != null && mdat.start > moov.start && delta != 0L) shift(newMoov, 8, newMoov.size, delta)
        val out = ByteArrayOutputStream(file.size + delta.toInt())
        out.write(file, 0, moov.start)
        out.write(newMoov)
        out.write(file, moov.start + moov.size, file.size - moov.start - moov.size)
        return out.toByteArray()
    }

    /** Every chunk's offset (stco, co64) moved by `delta`. */
    private fun shift(b: ByteArray, from: Int, to: Int, delta: Long) {
        for (c in boxes(b, from, to)) {
            when (c.type) {
                in CONTAINERS -> shift(b, c.start + c.header, c.start + c.size, delta)
                "stco" -> { val n = read32(b, c.start + 12).toInt(); for (i in 0 until n) { val at = c.start + 16 + 4 * i; put32(b, at, read32(b, at) + delta) } }
                "co64" -> { val n = read32(b, c.start + 12).toInt(); for (i in 0 until n) { val at = c.start + 16 + 8 * i; put64(b, at, read64(b, at) + delta) } }
            }
        }
    }
}
