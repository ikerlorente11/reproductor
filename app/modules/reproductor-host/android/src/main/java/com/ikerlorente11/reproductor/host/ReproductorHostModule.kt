package com.ikerlorente11.reproductor.host

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.BindException

/** The native side of El Reproductor for Android: starts the local server the web view loads the page from (see
 * HostServer) and keeps it while the app lives. */
class ReproductorHostModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ReproductorHost")

        /** Starts the server (or finds it running) and says where the page is: `{ url, token }`. */
        AsyncFunction("start") {
            val running = server
            if (running != null && running.isAlive) {
                return@AsyncFunction mapOf("url" to "http://127.0.0.1:${running.listeningPort}/", "token" to running.token)
            }
            val context = appContext.reactContext ?: throw IllegalStateException("sin contexto de la app")
            var last: Exception? = null
            for (port in HostServer.PORT until HostServer.PORT + 5) {
                try {
                    val candidate = HostServer(context.applicationContext, port)
                    candidate.start()
                    server = candidate
                    Log.i("reproductor", "host en 127.0.0.1:$port")
                    return@AsyncFunction mapOf("url" to "http://127.0.0.1:$port/", "token" to candidate.token)
                } catch (e: BindException) {
                    last = e
                }
            }
            throw IllegalStateException("No se pudo abrir el servidor local: ${last?.message}")
        }

        /** The page the app's JavaScript brings (a zip among its assets: an update brings a new one), served from now on
         * instead of the APK's; its folder, or null when it could not be used (the APK's goes on). */
        AsyncFunction("useWeb") { uri: String, hash: String ->
            val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction null
            Web.use(context, uri, hash)
        }

        /** The permission to read the music was just given: the library reads it. */
        Function("rescan") { server?.library?.scan() }
    }

    companion object {
        /** one server for the process: the activity may be made again (and this module with it) while the music plays */
        @Volatile private var server: HostServer? = null
    }
}
