package com.ikerlorente11.reproductor.host

import android.content.Context
import android.net.Uri
import android.util.Log
import java.io.File
import java.util.zip.ZipFile

/**
 * The page the web view shows as the app's JavaScript brings it: a zip among its assets, so an
 * EAS Update carries a new page too (see scripts/zip-web.mjs). It is unpacked once per version, into
 * `files/web/<hash>/`, and the host serves it from there; without one (or if it cannot be unpacked) the
 * viewer built into the APK is served, as before. Only the current version is kept.
 */
object Web {
    /** where the page is served from; null: the APK's own */
    @Volatile
    var current: File? = null
        private set

    fun use(context: Context, uri: String, hash: String): String? {
        val safeHash = hash.filter { it.isLetterOrDigit() }.ifEmpty { return null }
        val root = File(context.filesDir, "web")
        val dir = File(root, safeHash)
        try {
            if (!File(dir, "index.html").isFile) {
                val zip = File(Uri.parse(uri).path ?: return null)
                val part = File(root, "$safeHash.part").also { it.deleteRecursively(); it.mkdirs() }
                unpack(zip, part)
                if (!File(part, "index.html").isFile) throw IllegalStateException("no trae index.html")
                dir.deleteRecursively()
                if (!part.renameTo(dir)) throw IllegalStateException("no se pudo dejar en su sitio")
            }
            current = dir
            // the versions before this one go
            root.listFiles()?.filter { it.name != safeHash }?.forEach { it.deleteRecursively() }
            Log.i("reproductor", "página de la actualización $safeHash")
            return dir.absolutePath
        } catch (e: Exception) {
            Log.w("reproductor", "página del APK: el de la actualización no se pudo abrir", e)
            current = null
            return null
        }
    }

    private fun unpack(zip: File, into: File) {
        val base = into.canonicalPath + File.separator
        ZipFile(zip).use { z ->
            for (entry in z.entries()) {
                if (entry.isDirectory) continue
                val out = File(into, entry.name).canonicalFile
                // nothing outside its folder
                if (!out.path.startsWith(base)) throw IllegalStateException("ruta fuera de la página: ${entry.name}")
                out.parentFile?.mkdirs()
                z.getInputStream(entry).use { input -> out.outputStream().use { input.copyTo(it) } }
            }
        }
    }

    /** A file of the page in use, or null (then the APK's). */
    fun file(name: String): File? {
        val dir = current ?: return null
        val f = File(dir, name).canonicalFile
        return f.takeIf { it.isFile && it.path.startsWith(dir.canonicalPath + File.separator) }
    }
}
