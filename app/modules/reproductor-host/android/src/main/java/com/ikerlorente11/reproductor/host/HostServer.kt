package com.ikerlorente11.reproductor.host

import android.content.Context
import android.os.Build
import android.provider.Settings.Global
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.SecureRandom
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.TimeUnit

/**
 * The local server the web view talks to, on 127.0.0.1 only. It serves the app's page (built into the module's
 * assets, `web/`) and is the «host» the page's backends talk to (see web/src/lib/host.ts), as the Rust side of the
 * desktop app:
 * - this device's music (`/host/library`, `/f/<id>`, `/c/<cover>`, `/l/<id>`; see Library);
 * - the cloud of a server of El Reproductor (`/host/cloud`, `/w/<path>`, the copies kept on the device; see Cloud);
 * - the sound (`/host/audio` and the `audio` events; see Playback);
 * - any server for the page, without the web view's CORS (`/host/fetch?url=`): the service, soundlift, Subsonic…;
 * - the page's settings and secrets (`/host/prefs`, `/host/secret`), and what happens as server-sent events.
 * Everything but the page's own files needs the token given at start (`?t=` or the `X-Host-Token` header): other
 * apps of the device can reach this port too.
 *
 * The port is fixed (the page's localStorage belongs to the origin, port included); the next ones are tried only if it
 * is taken.
 */
class HostServer(private val context: Context, port: Int) : NanoHTTPD("127.0.0.1", port) {
    val token: String = ByteArray(24).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    val settings = Settings(context)
    val events = Events()
    val library = Library(context, settings, events)
    private val cloud = Cloud(settings, events)
    /** the player; what it was left playing is played again here, with this server's address and token */
    val playback = Playback(context, events) { "http://127.0.0.1:$listeningPort" to token }
    private val pinger = Timer("reproductor-events", true)
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    /** the installed app's version (app.json's), which Settings shows */
    private val appVersion: String by lazy {
        try { context.packageManager.getPackageInfo(context.packageName, 0).versionName } catch (_: Exception) { null } ?: VERSION
    }
    private val userAgent: String by lazy { "ElReproductor/$appVersion (Android)" }

    override fun start() {
        super.start(SOCKET_READ_TIMEOUT, false)
        pinger.schedule(object : TimerTask() { override fun run() = events.ping() }, 20_000L, 20_000L)
    }

    override fun stop() {
        pinger.cancel()
        events.closeAll()
        library.close()
        playback.release()
        super.stop()
    }

    /** Never gzip: it held back the event stream (see La Estantería's host). */
    override fun useGzipWhenAccepted(r: Response): Boolean = false

    /** One connection per request: NanoHTTPD's keep-alive loses the odd request the browser sends on a connection it is closing. */
    override fun serve(session: IHTTPSession): Response = answer(session).also { cors(it); it.closeConnection(true) }

    /** The page may come from another origin while developing (Vite on the PC): the token still guards everything. */
    private fun cors(response: Response) {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Host-Token, Range, X-Fetch-Headers")
        response.addHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, PROPFIND")
        response.addHeader("Access-Control-Expose-Headers", EXPOSED)
    }

    private fun answer(session: IHTTPSession): Response {
        val path = session.uri
        return try {
            when {
                session.method == Method.OPTIONS -> newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
                path == "/" || path.startsWith("/assets/") || path.startsWith("/icons/") || path == "/favicon.ico" -> page(path)
                !authorized(session) -> json(Response.Status.UNAUTHORIZED, JSONObject().put("detail", "falta el token del host"))
                path == "/host/info" -> json(Response.Status.OK, info())
                path == "/host/events" -> eventStream()
                path == "/host/fetch" -> fetchRoute(session)
                path == "/host/prefs" -> prefsRoute(session)
                path == "/host/secret" -> secretRoute(session)
                path == "/host/audio" -> json(Response.Status.OK, playback.command(body(session)))
                path.startsWith("/host/library") -> libraryRoute(session, path.removePrefix("/host/library").trimStart('/'))
                path.startsWith("/host/cloud") -> cloudRoute(session, path.removePrefix("/host/cloud").trimStart('/'))
                path.startsWith("/host/offline") -> offlineRoute(session, path.removePrefix("/host/offline").trimStart('/'))
                path.startsWith("/f/") -> library.file(path.removePrefix("/f/"))?.let { (stream, mime, size) -> ranged(session, stream, mime, size) } ?: notFound(path)
                path.startsWith("/c/") -> library.cover(path.removePrefix("/c/"))?.let { f -> binary(FileInputStream(f), "image/jpeg", f.length(), cache = true) } ?: notFound(path)
                path.startsWith("/l/") -> library.lyrics(path.removePrefix("/l/"))?.let { newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", it) } ?: notFound(path)
                path.startsWith("/w/") -> cloudSong(session, path.removePrefix("/w"))
                else -> notFound(path)
            }
        } catch (e: Cloud.NotFound) {
            notFound(path)
        } catch (e: IllegalArgumentException) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("detail", e.message ?: e.toString()))
        } catch (e: Exception) {
            Log.w("reproductor", "error sirviendo $path", e)
            json(Response.Status.INTERNAL_ERROR, JSONObject().put("detail", e.message ?: e.toString()))
        }
    }

    /** The token, in `X-Host-Token` or in `?t=` (songs, covers). */
    private fun authorized(session: IHTTPSession): Boolean {
        val given = session.headers["x-host-token"] ?: session.parameters["t"]?.firstOrNull()
        return given == token
    }

    // ---- the page: built into the assets, or the one an update brought (see Web) ----
    private fun page(path: String): Response {
        val name = if (path == "/") "index.html" else path.trimStart('/')
        val stream = Web.file(name)?.inputStream() ?: try { context.assets.open("web/$name") } catch (_: Exception) { return notFound(path) }
        val response = newChunkedResponse(Response.Status.OK, mimeOf(name), stream)
        response.setGzipEncoding(false)
        if (name != "index.html") response.addHeader("Cache-Control", "max-age=31536000, immutable")
        return response
    }

    private fun info(): JSONObject = JSONObject()
        .put("version", appVersion)
        .put("device", deviceName())
        .put("library", library.allowed())
        .put("music", settings.musicDir().absolutePath)

    /** What the person calls this device (Ajustes de Android › Acerca del teléfono), else its model. */
    private fun deviceName(): String {
        val named = try { Global.getString(context.contentResolver, Global.DEVICE_NAME) } catch (_: Exception) { null }
        return named?.takeIf { it.isNotBlank() } ?: listOf(Build.MANUFACTURER.replaceFirstChar { it.uppercase() }, Build.MODEL)
            .distinct().joinToString(" ").let { if (Build.MODEL.startsWith(Build.MANUFACTURER, ignoreCase = true)) Build.MODEL else it }
    }

    // ---- this device's music ----
    private fun libraryRoute(session: IHTTPSession, rest: String): Response {
        val m = session.method
        return when {
            rest.isEmpty() && m == Method.GET -> json(Response.Status.OK, library.get())
            rest == "scan" && m == Method.POST -> { library.scan(); empty() }
            rest == "hide" && m == Method.POST -> { library.hideRoot(body(session).getString("path")); empty() }
            rest == "show" && m == Method.POST -> json(Response.Status.OK, JSONObject().put("shown", library.showRoots()))
            rest == "open" && m == Method.POST -> json(Response.Status.OK, library.open(body(session).getString("uri")))
            else -> notFound("/host/library/$rest")
        }
    }

    // ---- the cloud of a server of El Reproductor ----
    private fun cloudRoute(session: IHTTPSession, rest: String): Response {
        val m = session.method
        return when {
            rest.isEmpty() && m == Method.PUT -> { cloud.set(body(session)); empty() }
            rest.isEmpty() && m == Method.DELETE -> { cloud.set(JSONObject()); empty() }
            rest == "list" && m == Method.POST -> json(Response.Status.OK, cloud.list(body(session).getString("dir")))
            rest == "remove" && m == Method.POST -> { cloud.remove(body(session).getString("path")); empty() }
            else -> notFound("/host/cloud/$rest")
        }
    }

    private fun offlineRoute(session: IHTTPSession, rest: String): Response {
        val paths = body(session).optJSONArray("paths") ?: JSONArray()
        return when (rest) {
            "have" -> jsonArray(cloud.have(paths))
            "get" -> { cloud.get(paths); empty() }
            "remove" -> { cloud.forget(paths); empty() }
            else -> notFound("/host/offline/$rest")
        }
    }

    /** `/w/<path>`: a song of the cloud (its copy on this device when there is one), by the ranges the player asks for. */
    private fun cloudSong(session: IHTTPSession, encoded: String): Response {
        val path = Cloud.decode(encoded)
        val (file, res) = cloud.open(path, session.headers["range"])
        if (file != null) return ranged(session, FileInputStream(file), Library.mimeOf(file.name), file.length())
        val upstream = res!!
        val body = upstream.body
        if (!upstream.isSuccessful || body == null) {
            val code = upstream.code
            upstream.close()
            return json(status(code), JSONObject().put("detail", "la nube respondió $code"))
        }
        // the cloud says application/octet-stream: the type by the extension
        val mime = Library.mimeOf(path).takeIf { it != "application/octet-stream" } ?: (upstream.header("Content-Type") ?: "application/octet-stream")
        val length = body.contentLength()
        val response = if (length >= 0) newFixedLengthResponse(status(upstream.code), mime, body.byteStream(), length)
            else newChunkedResponse(status(upstream.code), mime, body.byteStream())
        response.setGzipEncoding(false)
        response.addHeader("Accept-Ranges", "bytes")
        response.addHeader("Cache-Control", "no-store")
        upstream.header("Content-Range")?.let { response.addHeader("Content-Range", it) }
        return response
    }

    // ---- any server, for the page: `/host/fetch?url=`, the headers to send in X-Fetch-Headers (JSON) ----
    private fun fetchRoute(session: IHTTPSession): Response {
        val given = session.parameters["url"]?.firstOrNull()?.trim().orEmpty()
        val scheme = given.substringBefore(':', "").lowercase()
        if (scheme != "http" && scheme != "https") throw IllegalArgumentException("Solo se pueden pedir direcciones http o https.")
        val target: HttpUrl = given.toHttpUrlOrNull() ?: throw IllegalArgumentException("La dirección no es válida: $given")
        val headers = session.headers["x-fetch-headers"]?.takeIf { it.isNotBlank() }?.let {
            try { JSONObject(it) } catch (_: Exception) { throw IllegalArgumentException("X-Fetch-Headers tiene que ser un objeto JSON.") }
        }
        val method = session.method.name.uppercase()
        val bytes = if (method == "GET" || method == "HEAD") null else readBodyBytes(session)
        val builder = Request.Builder().url(target)
        var type = session.headers["content-type"]
        var agent = false
        headers?.keys()?.forEach { name ->
            val value = headers.optString(name, "")
            val lower = name.lowercase()
            when {
                lower in DROPPED || lower.startsWith("proxy-") -> {}
                lower == "content-type" -> type = value
                else -> {
                    try { builder.header(name, value) } catch (e: IllegalArgumentException) { throw IllegalArgumentException("La cabecera «$name» no es válida.") }
                    if (lower == "user-agent") agent = true
                }
            }
        }
        if (!agent) builder.header("User-Agent", userAgent)
        val media = type?.toMediaTypeOrNull()
        val requestBody = when {
            method == "GET" || method == "HEAD" -> null
            bytes != null && bytes.isNotEmpty() -> bytes.toRequestBody(media)
            method in NEEDS_BODY -> ByteArray(0).toRequestBody(media)
            else -> null
        }
        builder.method(method, requestBody)
        val upstream = try { client.newCall(builder.build()).execute() } catch (e: java.io.IOException) {
            return json(status(502), JSONObject().put("detail", "Sin conexión con ${target.host}: ${e.message ?: e.javaClass.simpleName}"))
                .also { it.addHeader("X-Fetch-Error", "1") }
        }
        val content = upstream.body
        val stream: InputStream = content?.byteStream() ?: ByteArrayInputStream(ByteArray(0)).also { upstream.close() }
        val length = content?.contentLength() ?: 0L
        val responseType = upstream.header("Content-Type") ?: "application/octet-stream"
        val response = if (length >= 0) newFixedLengthResponse(status(upstream.code), responseType, stream, length)
            else newChunkedResponse(status(upstream.code), responseType, stream)
        response.setGzipEncoding(false)
        response.addHeader("X-Fetch-Url", upstream.request.url.toString())
        for (name in FORWARDED) upstream.header(name)?.let { response.addHeader(name, it) }
        return response
    }

    // ---- the page's settings and secrets ----
    private fun prefsRoute(session: IHTTPSession): Response {
        if (session.method == Method.PUT) settings.setPrefs(body(session))
        else if (session.method != Method.GET) return json(Response.Status.METHOD_NOT_ALLOWED, JSONObject().put("detail", "no"))
        return json(Response.Status.OK, settings.prefs())
    }

    private fun secretRoute(session: IHTTPSession): Response {
        val key = session.parameters["key"]?.firstOrNull().orEmpty()
        if (key.isEmpty() || key.length > 256 || key.any { it.isISOControl() }) throw IllegalArgumentException("Esa clave no vale.")
        return when (session.method) {
            Method.GET -> json(Response.Status.OK, JSONObject().put("value", settings.secret(key) ?: JSONObject.NULL))
            Method.PUT -> {
                val b = body(session)
                settings.saveSecret(key, if (b.isNull("value")) null else b.getString("value").take(64 * 1024))
                empty()
            }
            Method.DELETE -> { settings.saveSecret(key, null); empty() }
            else -> json(Response.Status.METHOD_NOT_ALLOWED, JSONObject().put("detail", "no"))
        }
    }

    private fun eventStream(): Response {
        val response = newChunkedResponse(Response.Status.OK, "text/event-stream; charset=utf-8", events.open())
        response.setGzipEncoding(false)
        response.addHeader("Cache-Control", "no-cache")
        return response
    }

    // ---- helpers ----
    private fun ranged(session: IHTTPSession, stream: InputStream, mime: String, size: Long): Response {
        val range = ByteRange.parse(session.headers["range"], size)
        if (range == null) return binary(stream, mime, size, cache = false).also { if (size >= 0) it.addHeader("Accept-Ranges", "bytes") }
        if (range.isEmpty()) {
            stream.close()
            return newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "").also {
                it.setGzipEncoding(false)
                it.addHeader("Content-Range", "bytes */$size")
                it.addHeader("Accept-Ranges", "bytes")
            }
        }
        val start = range.first
        val end = range.last
        var skipped = 0L
        while (skipped < start) { val n = stream.skip(start - skipped); if (n <= 0) break; skipped += n }
        val length = end - start + 1
        val limited = object : InputStream() {
            var left = length
            override fun read(): Int = if (left <= 0) -1 else stream.read().also { if (it >= 0) left-- }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (left <= 0) return -1
                val n = stream.read(b, off, minOf(len.toLong(), left).toInt())
                if (n > 0) left -= n
                return n
            }
            override fun close() = stream.close()
        }
        val response = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mime, limited, length)
        response.setGzipEncoding(false)
        response.addHeader("Content-Range", "bytes $start-$end/$size")
        response.addHeader("Accept-Ranges", "bytes")
        return response
    }

    private fun binary(stream: InputStream, mime: String, length: Long, cache: Boolean): Response {
        val response = if (length >= 0) newFixedLengthResponse(Response.Status.OK, mime, stream, length) else newChunkedResponse(Response.Status.OK, mime, stream)
        response.setGzipEncoding(false)
        if (cache) response.addHeader("Cache-Control", "private, max-age=86400")
        return response
    }

    private fun json(status: Response.IStatus, body: JSONObject): Response =
        newFixedLengthResponse(status, "application/json", body.toString()).also { it.setGzipEncoding(false) }
    private fun jsonArray(body: JSONArray): Response =
        newFixedLengthResponse(Response.Status.OK, "application/json", body.toString()).also { it.setGzipEncoding(false) }
    private fun empty(): Response = newFixedLengthResponse(Response.Status.OK, "application/json", "null").also { it.setGzipEncoding(false) }
    private fun notFound(path: String): Response = json(Response.Status.NOT_FOUND, JSONObject().put("detail", "no existe $path"))

    private fun readBodyBytes(session: IHTTPSession): ByteArray {
        val length = session.headers["content-length"]?.toIntOrNull() ?: 0
        val data = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = session.inputStream.read(data, read, length - read)
            if (n < 0) break
            read += n
        }
        return if (read == length) data else data.copyOf(read)
    }

    private fun body(session: IHTTPSession): JSONObject = JSONObject(String(readBodyBytes(session), Charsets.UTF_8).ifBlank { "{}" })

    private fun status(code: Int): Response.IStatus =
        Response.Status.lookup(code) ?: object : Response.IStatus {
            override fun getRequestStatus() = code
            override fun getDescription() = "$code Status"
        }

    private fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html; charset=utf-8"
        "js", "mjs" -> "text/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "json" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        "ico" -> "image/x-icon"
        else -> "application/octet-stream"
    }

    companion object {
        const val PORT = 48143
        const val SOCKET_READ_TIMEOUT = 30_000
        const val VERSION = "0.1.0"
        private val DROPPED = setOf("host", "connection", "keep-alive", "upgrade", "te", "trailer", "transfer-encoding",
            "content-length", "accept-encoding", "x-host-token", "x-fetch-headers", "cookie2")
        private val NEEDS_BODY = setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")
        private val FORWARDED = listOf("Content-Disposition", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Cache-Control",
            "WWW-Authenticate", "Link", "Retry-After", "DAV", "Location")
        private val EXPOSED = (listOf("X-Fetch-Url", "X-Fetch-Error") + FORWARDED).joinToString(", ")
    }
}
