package com.ikerlorente11.reproductor.host

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Shows the app's player to the system (see Playback): the notification with its buttons, the lock screen, the
 * headphones' and Bluetooth buttons. Media3 makes it a foreground service while the music plays, so Android keeps
 * the app alive with the screen off. Swiping the app away while paused stops it; while it plays, the music goes on.
 */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val player = Playback.player ?: run { stopSelf(); return }
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        session = MediaSession.Builder(this, player).also { b -> open?.let { b.setSessionActivity(it) } }.build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        session?.release()
        session = null
        Playback.drop()
        super.onDestroy()
    }
}
