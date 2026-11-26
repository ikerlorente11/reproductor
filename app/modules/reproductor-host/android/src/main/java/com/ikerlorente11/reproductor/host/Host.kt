package com.ikerlorente11.reproductor.host

import android.content.Context
import android.util.Log
import java.net.BindException

/**
 * The local server, one for the whole process: the app starts it to load its page (ReproductorHostModule), and the
 * widget starts it too when the app is closed, to play from where the player was left (see Playback.resume).
 */
object Host {
    @Volatile private var server: HostServer? = null

    /** The server running, started now if it was not (on the fixed port, or the next ones if it is taken). */
    @Synchronized
    fun ensure(context: Context): HostServer {
        server?.takeIf { it.isAlive }?.let { return it }
        var last: Exception? = null
        for (port in HostServer.PORT until HostServer.PORT + 5) {
            try {
                val candidate = HostServer(context.applicationContext, port)
                candidate.start()
                server = candidate
                Log.i("reproductor", "host en 127.0.0.1:$port")
                return candidate
            } catch (e: BindException) {
                last = e
            }
        }
        throw IllegalStateException("No se pudo abrir el servidor local: ${last?.message}")
    }

    /** The server, if it runs (nothing is started). */
    fun running(): HostServer? = server?.takeIf { it.isAlive }
}
