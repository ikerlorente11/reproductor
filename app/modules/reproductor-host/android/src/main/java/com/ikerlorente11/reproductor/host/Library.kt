package com.ikerlorente11.reproductor.host

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Log
import android.util.Size
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * The music of this device, as Android's media index (MediaStore) has it: every song with its tags, already read by the
 * system, so there is nothing to scan by hand. The index answers the page's `DeviceBackend` (see host.ts): the songs
 * (`DeviceTrack`, the same shape the desktop's Rust side gives), the folders they are in (the ones right inside each
 * storage: Music, Download…; the person can leave some out) and their covers, extracted once and kept with the app's
 * files. A song's id is a hash of its path, as on the desktop, so the lists and the history that name it survive the
 * system indexing it again. Changes in the media index (a song copied in, one deleted) read it again by themselves.
 */
class Library(private val context: Context, private val settings: Settings, private val events: Events) {
    private class Entry(val json: JSONObject, val uri: Uri, val path: String, val size: Long)

    @Volatile private var tracks: List<Entry> = emptyList()
    @Volatile private var roots: List<String> = emptyList()
    private val byId = ConcurrentHashMap<String, Entry>()
    /** files other apps opened with El Reproductor («Abrir con»), by the id given them */
    private val opened = ConcurrentHashMap<String, Entry>()
    private val openedCount = AtomicInteger()
    private val scanning = AtomicBoolean(false)
    private val again = AtomicBoolean(false)
    private val worker = Executors.newSingleThreadExecutor()
    private val coversDir = File(context.filesDir, "covers").also { it.mkdirs() }
    private val indexFile = File(context.filesDir, "library.json")
    /** what is known of each album's cover: `yes`, or `no:<newest change of its songs>` (looked at again if it changes) */
    private val covers = ConcurrentHashMap<String, String>()
    private var observer: ContentObserver? = null

    init {
        load()
    }

    fun allowed(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    /** `{ roots, tracks, scanning }`, as the page wants it */
    fun get(): JSONObject {
        val list = JSONArray()
        for (t in tracks) list.put(t.json)
        return JSONObject().put("roots", JSONArray(roots)).put("tracks", list).put("scanning", scanning.get())
    }

    /** Reads the media index again, in the background; `library-changed` says when it is done. */
    fun scan() {
        watch()
        if (!scanning.compareAndSet(false, true)) { again.set(true); return }
        worker.execute {
            var error: String? = null
            try {
                do {
                    again.set(false)
                    if (!allowed()) { error = "El Reproductor necesita permiso para leer la música del móvil (Ajustes de Android › Aplicaciones › El Reproductor › Permisos)."; break }
                    read()
                } while (again.get())
            } catch (e: Exception) {
                Log.w("reproductor", "biblioteca", e)
                error = e.message ?: e.toString()
            } finally {
                scanning.set(false)
                events.send("library-changed", JSONObject().put("error", error ?: JSONObject.NULL))
            }
        }
    }

    fun hideRoot(path: String) {
        settings.hiddenRoots = settings.hiddenRoots + path.trimEnd('/')
        scan()
    }

    /** The folders left out come back (there is no folder to choose: Android's index has all the music). */
    fun showRoots(): Boolean {
        val had = settings.hiddenRoots.isNotEmpty()
        settings.hiddenRoots = emptySet()
        scan()
        return had
    }

    // ---- reading the media index ----
    private fun read() {
        val hidden = settings.hiddenRoots
        val found = mutableListOf<Entry>()
        val rootsFound = sortedSetOf<String>()
        val albumNewest = HashMap<Long, Long>()
        val columns = arrayOf(
            MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST, "album_artist",
            MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.ALBUM_ID, MediaStore.Audio.Media.TRACK, MediaStore.Audio.Media.YEAR,
            MediaStore.Audio.Media.DURATION
        ) + (if (Build.VERSION.SDK_INT >= 30) arrayOf(MediaStore.Audio.Media.GENRE, MediaStore.Audio.Media.DISC_NUMBER, MediaStore.Audio.Media.CD_TRACK_NUMBER) else emptyArray())
        val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        context.contentResolver.query(uri, columns, "${MediaStore.Audio.Media.IS_MUSIC} != 0", null, null)?.use { c ->
            val col = { name: String -> c.getColumnIndex(name) }
            val iId = col(MediaStore.Audio.Media._ID); val iData = col(MediaStore.Audio.Media.DATA); val iSize = col(MediaStore.Audio.Media.SIZE)
            val iMod = col(MediaStore.Audio.Media.DATE_MODIFIED); val iAdded = col(MediaStore.Audio.Media.DATE_ADDED)
            val iTitle = col(MediaStore.Audio.Media.TITLE); val iArtist = col(MediaStore.Audio.Media.ARTIST); val iAlbumArtist = col("album_artist")
            val iAlbum = col(MediaStore.Audio.Media.ALBUM); val iAlbumId = col(MediaStore.Audio.Media.ALBUM_ID); val iTrack = col(MediaStore.Audio.Media.TRACK)
            val iYear = col(MediaStore.Audio.Media.YEAR); val iDuration = col(MediaStore.Audio.Media.DURATION)
            val iGenre = col("genre"); val iDisc = col("disc_number"); val iCdTrack = col("cd_track_number")
            val str = { i: Int -> if (i < 0) "" else (c.getString(i) ?: "").let { if (it == MediaStore.UNKNOWN_STRING) "" else it.trim() } }
            val num = { i: Int -> if (i < 0 || c.isNull(i)) 0L else c.getLong(i) }
            while (c.moveToNext()) {
                val path = str(iData)
                if (path.isEmpty()) continue
                val root = rootOf(path)
                // the audio of other apps (WhatsApp's, in Android/media) is not music of the person
                if (root in hidden || OTHER_APPS.containsMatchIn(path)) continue
                rootsFound.add(root)
                val mediaId = num(iId)
                val albumId = num(iAlbumId)
                val mtime = num(iMod)
                albumNewest[albumId] = maxOf(albumNewest[albumId] ?: 0L, mtime)
                val trackField = num(iTrack)
                // the track as tagged ("3/12"); the old column mixes the disc in (1003) and some systems fill it wrong
                val track = str(iCdTrack).substringBefore('/').trim().toIntOrNull() ?: (trackField % 1000).toInt()
                val disc = str(iDisc).substringBefore('/').trim().toIntOrNull() ?: (trackField / 1000).toInt()
                val name = path.substringAfterLast('/')
                val json = JSONObject()
                    .put("id", idOf(path))
                    .put("path", path)
                    .put("size", num(iSize))
                    .put("mtime", mtime)
                    .put("title", str(iTitle).ifEmpty { name.substringBeforeLast('.') })
                    .put("artist", str(iArtist))
                    .put("album_artist", str(iAlbumArtist))
                    .put("album", str(iAlbum))
                    .put("track", track)
                    .put("disc", disc)
                    .put("year", num(iYear).toInt())
                    .put("genre", str(iGenre))
                    .put("duration", num(iDuration) / 1000.0)
                    .put("cover", "a$albumId")
                    .put("added", num(iAdded))
                found.add(Entry(json, ContentUris.withAppendedId(uri, mediaId), path, num(iSize)))
            }
        }
        // the covers not known yet (or of albums that changed since they had none)
        val missing = albumNewest.filter { (album, newest) ->
            val known = covers[album.toString()]
            known == null || (known.startsWith("no:") && (known.removePrefix("no:").toLongOrNull() ?: 0L) < newest)
        }.keys.toList()
        missing.forEachIndexed { n, album ->
            if (n % 10 == 0) events.send("library-progress", JSONObject().put("done", n).put("total", missing.size))
            val track = found.firstOrNull { it.json.optString("cover") == "a$album" }
            covers[album.toString()] = if (extractCover(album, track)) "yes" else "no:${albumNewest[album]}"
        }
        for (t in found) {
            val album = t.json.optString("cover").removePrefix("a")
            if (covers[album] != "yes") t.json.put("cover", JSONObject.NULL)
        }
        tracks = found
        roots = rootsFound.toList()
        byId.clear()
        for (t in found) byId[t.json.getString("id")] = t
        events.send("library-progress", JSONObject().put("done", found.size).put("total", found.size))
        save()
    }

    /** The folder right inside its storage a song is in (`/storage/emulated/0/Music`), or the storage itself. */
    private fun rootOf(path: String): String {
        val m = ROOT.find(path) ?: return path.substringBeforeLast('/')
        val volume = m.groupValues[1]
        val rest = path.removePrefix("$volume/")
        return if (rest.contains('/')) "$volume/${rest.substringBefore('/')}" else volume
    }

    private fun extractCover(album: Long, track: Entry?): Boolean {
        val out = File(coversDir, "$album.jpg")
        return try {
            val bitmap: Bitmap? = if (Build.VERSION.SDK_INT >= 29) {
                try {
                    context.contentResolver.loadThumbnail(ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, album), Size(COVER, COVER), null)
                } catch (_: Exception) { null }
            } else null
            val image = bitmap ?: track?.let { embedded(it.uri) } ?: return false.also { out.delete() }
            out.outputStream().use { image.compress(Bitmap.CompressFormat.JPEG, 88, it) }
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun embedded(uri: Uri): Bitmap? {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(context, uri)
            val bytes = r.embeddedPicture ?: return null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= COVER) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        } catch (_: Exception) { null } finally { try { r.release() } catch (_: Exception) {} }
    }

    // ---- what the page plays: a song's file, its cover, its lyrics ----
    /** The song's bytes: the stream, its type and its size. */
    fun file(id: String): Triple<InputStream, String, Long>? {
        val t = byId[id] ?: opened[id] ?: return null
        val fd = context.contentResolver.openAssetFileDescriptor(t.uri, "r") ?: return null
        val size = if (fd.length >= 0) fd.length else t.size
        return Triple(fd.createInputStream(), mimeOf(t.path), size)
    }

    fun cover(id: String): File? = File(coversDir, "${id.removePrefix("a").filter { it.isDigit() || it == '-' }}.jpg").takeIf { it.isFile }

    /** The `.lrc` next to the song (Android lets the app read it only in some folders; else LRCLIB). */
    fun lyrics(id: String): String? {
        val t = byId[id] ?: opened[id] ?: return null
        return try { File(t.path.substringBeforeLast('.') + ".lrc").takeIf { it.isFile }?.readText() } catch (_: Exception) { null }
    }

    /** A file another app opened with El Reproductor: the song of the library it is, or one apart (played as it is). */
    fun open(raw: String): JSONObject {
        val uri = Uri.parse(raw)
        // a song of the media index: its id, its path
        if (uri.authority == MediaStore.AUTHORITY) {
            val mediaId = try { ContentUris.parseId(uri) } catch (_: Exception) { -1L }
            tracks.firstOrNull { ContentUris.parseId(it.uri) == mediaId }?.let { return it.json }
        }
        if (uri.scheme == "file") uri.path?.let { p -> tracks.firstOrNull { it.path == p }?.let { return it.json } }
        val r = MediaMetadataRetriever()
        val name = displayName(uri)
        val json = JSONObject()
        try {
            r.setDataSource(context, uri)
            val meta = { key: Int -> (r.extractMetadata(key) ?: "").trim() }
            json.put("title", meta(MediaMetadataRetriever.METADATA_KEY_TITLE).ifEmpty { name.substringBeforeLast('.') })
                .put("artist", meta(MediaMetadataRetriever.METADATA_KEY_ARTIST))
                .put("album_artist", meta(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST))
                .put("album", meta(MediaMetadataRetriever.METADATA_KEY_ALBUM))
                .put("track", meta(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER).substringBefore('/').toIntOrNull() ?: 0)
                .put("disc", meta(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER).substringBefore('/').toIntOrNull() ?: 0)
                .put("year", meta(MediaMetadataRetriever.METADATA_KEY_YEAR).toIntOrNull() ?: 0)
                .put("genre", meta(MediaMetadataRetriever.METADATA_KEY_GENRE))
                .put("duration", (meta(MediaMetadataRetriever.METADATA_KEY_DURATION).toLongOrNull() ?: 0L) / 1000.0)
        } catch (e: Exception) {
            json.put("title", name.substringBeforeLast('.')).put("artist", "").put("album_artist", "").put("album", "")
                .put("track", 0).put("disc", 0).put("year", 0).put("genre", "").put("duration", 0)
        } finally { try { r.release() } catch (_: Exception) {} }
        val id = "x${openedCount.incrementAndGet()}"
        val now = System.currentTimeMillis() / 1000
        json.put("id", id).put("path", name).put("size", -1).put("mtime", now).put("cover", JSONObject.NULL).put("added", now)
        opened[id] = Entry(json, uri, name, -1)
        return json
    }

    private fun displayName(uri: Uri): String {
        try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.let { return it }
            }
        } catch (_: Exception) {}
        return uri.lastPathSegment?.substringAfterLast('/') ?: "canción"
    }

    // ---- kept between runs: the page shows the music at once, then it is read again ----
    private fun load() {
        try {
            if (!indexFile.isFile) return
            val saved = JSONObject(indexFile.readText())
            val list = saved.optJSONArray("tracks") ?: JSONArray()
            val ids = saved.optJSONObject("media") ?: JSONObject()
            val loaded = mutableListOf<Entry>()
            for (i in 0 until list.length()) {
                val json = list.getJSONObject(i)
                val id = json.getString("id")
                val mediaId = ids.optLong(id, -1)
                if (mediaId < 0) continue
                loaded.add(Entry(json, ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId), json.getString("path"), json.optLong("size")))
            }
            tracks = loaded
            for (t in loaded) byId[t.json.getString("id")] = t
            roots = saved.optJSONArray("roots")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
            saved.optJSONObject("covers")?.let { c -> for (k in c.keys()) covers[k] = c.getString(k) }
        } catch (e: Exception) {
            Log.w("reproductor", "índice de la biblioteca", e)
        }
    }

    private fun save() {
        try {
            val media = JSONObject()
            val list = JSONArray()
            for (t in tracks) { list.put(t.json); media.put(t.json.getString("id"), ContentUris.parseId(t.uri)) }
            val c = JSONObject()
            for ((k, v) in covers) c.put(k, v)
            val part = File(indexFile.path + ".part")
            part.writeText(JSONObject().put("tracks", list).put("media", media).put("roots", JSONArray(roots)).put("covers", c).toString())
            part.renameTo(indexFile)
        } catch (e: Exception) {
            Log.w("reproductor", "guardar el índice", e)
        }
    }

    /** A change in the media index reads it again (a few seconds later: a copy brings many changes at once). */
    private fun watch() {
        if (observer != null || !allowed()) return
        val handler = Handler(Looper.getMainLooper())
        val later = Runnable { scan() }
        observer = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean) {
                handler.removeCallbacks(later)
                handler.postDelayed(later, 4000)
            }
        }
        try { context.contentResolver.registerContentObserver(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, observer!!) } catch (_: Exception) { observer = null }
    }

    fun close() {
        observer?.let { try { context.contentResolver.unregisterContentObserver(it) } catch (_: Exception) {} }
        observer = null
        worker.shutdownNow()
    }

    companion object {
        private const val COVER = 600
        private val OTHER_APPS = Regex("^/storage/[^/]+(/\\d+)?/Android/")
        private val ROOT = Regex("^(/storage/emulated/\\d+|/storage/[^/]+|/sdcard|/mnt/media_rw/[^/]+)/")

        fun idOf(path: String): String {
            val digest = MessageDigest.getInstance("SHA-1").digest(path.toByteArray(Charsets.UTF_8))
            return digest.take(8).joinToString("") { "%02x".format(it) }
        }

        fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
            "mp3" -> "audio/mpeg"
            "flac" -> "audio/flac"
            "ogg", "oga" -> "audio/ogg"
            "opus" -> "audio/ogg"
            "m4a", "mp4", "aac" -> "audio/mp4"
            "wav" -> "audio/wav"
            "webm" -> "audio/webm"
            "lrc" -> "text/plain; charset=utf-8"
            else -> "application/octet-stream"
        }
    }
}
