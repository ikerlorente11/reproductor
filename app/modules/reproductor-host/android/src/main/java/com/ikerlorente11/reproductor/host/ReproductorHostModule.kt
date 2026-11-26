package com.ikerlorente11.reproductor.host

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The native side of El Reproductor for Android: starts the local server the web view loads the page from (see
 * HostServer and Host: one for the process, which the widget may have started already). */
class ReproductorHostModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ReproductorHost")

        /** Starts the server (or finds it running) and says where the page is: `{ url, token }`. */
        AsyncFunction("start") {
            val context = appContext.reactContext ?: throw IllegalStateException("sin contexto de la app")
            val server = Host.ensure(context.applicationContext)
            mapOf("url" to "http://127.0.0.1:${server.listeningPort}/", "token" to server.token)
        }

        /** The page the app's JavaScript brings (a zip among its assets: an update brings a new one), served from now on
         * instead of the APK's; its folder, or null when it could not be used (the APK's goes on). */
        AsyncFunction("useWeb") { uri: String, hash: String ->
            val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction null
            Web.use(context, uri, hash)
        }

        /** The permission to read the music was just given: the library reads it. */
        Function("rescan") { Host.running()?.library?.scan() }
    }
}
