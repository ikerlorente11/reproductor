package com.ikerlorente11.reproductor.host

import android.content.Context
import android.content.SharedPreferences
import android.os.Environment
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.io.File

/**
 * What the app keeps: the page's settings (the server connected, the folders left out…) in the app's preferences,
 * and its secrets (the server's app password, the libraries' passwords) encrypted with a key of the Android keystore,
 * like the credential store on Windows. The page reads and writes both through the host (/host/prefs, /host/secret).
 */
class Settings(private val context: Context) {
    private val plain: SharedPreferences = context.getSharedPreferences("reproductor", Context.MODE_PRIVATE)
    private val secret: SharedPreferences by lazy {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "reproductor.secret", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /** The page's settings: strings by key. */
    fun prefs(): JSONObject {
        val out = JSONObject()
        for ((k, v) in plain.all) if (k.startsWith(PAGE)) out.put(k.removePrefix(PAGE), v?.toString())
        return out
    }

    /** Sets the keys given (a null value deletes it). */
    fun setPrefs(values: JSONObject) {
        val edit = plain.edit()
        for (k in values.keys()) {
            if (k.length > KEY_MAX) throw IllegalArgumentException("Esa clave no vale.")
            if (values.isNull(k)) edit.remove(PAGE + k) else edit.putString(PAGE + k, values.get(k).toString().take(VALUE_MAX))
        }
        edit.commit()
    }

    fun secret(key: String): String? = secret.getString("page:$key", null)

    /** null deletes it */
    fun saveSecret(key: String, value: String?) {
        // commit, not apply: on a request thread, and a password lost to a killed app means signing in again
        if (value == null) secret.edit().remove("page:$key").commit()
        else secret.edit().putString("page:$key", value).commit()
    }

    /** The folders of this device's music the person took out of the library. */
    var hiddenRoots: Set<String>
        get() = plain.getStringSet("hiddenRoots", emptySet()) ?: emptySet()
        set(value) { plain.edit().putStringSet("hiddenRoots", value).commit() }

    /**
     * Where the songs of the cloud kept on this device go (and, later, what the download engine brings): the app's own
     * music folder, `Android/data/<app>/files/Music/El Reproductor`. Android's media index does not read it, so
     * those songs are not shown twice (once from the cloud, once as this device's).
     */
    fun musicDir(): File {
        val base = context.getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: File(context.filesDir, "Music")
        return File(base, "El Reproductor").also { it.mkdirs() }
    }

    companion object {
        private const val PAGE = "page."
        private const val KEY_MAX = 200
        private const val VALUE_MAX = 64 * 1024
    }
}
