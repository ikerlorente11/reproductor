package com.ikerlorente11.reproductor.host

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The sound of the app: Android's own player (Media3's ExoPlayer) in a media service (PlaybackService), so the music
 * goes on with the screen off and the system shows it (notification, lock screen, headphones' buttons, Bluetooth).
 * The page is the player's brain (its queue, `player.ts`), but it sleeps with the screen off: it hands this side a
 * window of its queue around the current song, which this side plays through by itself, telling the page which song it
 * is on (`moved`), the second it is at, when it plays and pauses. All of it goes over the host (`POST /host/audio` and
 * the `audio` events); the player lives on the main thread, so every command is run there.
 */
class Playback(private val context: Context, private val events: Events) {
    private val main = Handler(Looper.getMainLooper())
    private var controller: MediaController? = null
    private var lastKey: String? = null
    private val ticker = object : Runnable {
        override fun run() {
            val p = player ?: return
            if (p.isPlaying) {
                send("time", JSONObject().put("t", p.currentPosition / 1000.0))
                main.postDelayed(this, TICK_MS)
            }
        }
    }

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val p = player ?: return
            // a pause the player makes itself while loading (buffering) is not the person's
            if (!isPlaying && p.playWhenReady && p.playbackState == Player.STATE_BUFFERING) return
            send(if (isPlaying || p.playWhenReady) "play" else "pause", JSONObject().put("t", p.currentPosition / 1000.0))
            main.removeCallbacks(ticker)
            if (isPlaying) main.post(ticker)
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            val p = player ?: return
            if (!playWhenReady) send("pause", JSONObject().put("t", p.currentPosition / 1000.0))
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val key = mediaItem?.mediaId ?: return
            if (key == lastKey && reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) return
            lastKey = key
            send("moved", JSONObject().put("key", key))
        }

        override fun onPlaybackStateChanged(state: Int) {
            val p = player ?: return
            if (state == Player.STATE_READY && p.duration != C.TIME_UNSET) send("duration", JSONObject().put("d", p.duration / 1000.0))
            // the last song of the window ended: the page says what comes next (repeat, or nothing)
            if (state == Player.STATE_ENDED) send("ended", JSONObject())
        }

        override fun onPlayerError(error: PlaybackException) {
            val cause = error.cause?.message?.takeIf { it.isNotBlank() }
            send("error", JSONObject().put("message", when (error.errorCode) {
                PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "el servidor no la da (${cause ?: "error"})"
                PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "sin conexión"
                PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "la canción ya no está"
                PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "el móvil no sabe reproducir este formato"
                else -> cause ?: error.errorCodeName
            }))
            // the next song of the window, if there is one (as the browser's player goes on when one fails)
            val p = player ?: return
            if (p.hasNextMediaItem()) { p.seekToNextMediaItem(); p.prepare(); p.play() }
        }
    }

    private fun send(ev: String, body: JSONObject) = events.send("audio", body.put("ev", ev))

    /** Runs `block` on the main thread and answers what it gives (the host's request threads wait for it). */
    private fun <T> onMain(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result: Result<T>? = null
        val latch = CountDownLatch(1)
        main.post { result = runCatching(block); latch.countDown() }
        if (!latch.await(10, TimeUnit.SECONDS)) throw IllegalStateException("el reproductor no responde")
        return result!!.getOrThrow()
    }

    /** The player, made once (on the main thread), and the service that shows it to the system, started. */
    private fun ready(): ExoPlayer {
        val p = player ?: ExoPlayer.Builder(context)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
            .also { player = it; it.addListener(listener) }
        if (controller?.isConnected != true) {
            controller?.release()
            // connecting a controller starts the media service, which makes itself a foreground service while it plays
            val future = MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync()
            future.addListener({ controller = try { future.get() } catch (_: Exception) { null } }, { main.post(it) })
        }
        return p
    }

    private fun itemOf(o: JSONObject): MediaItem {
        val meta = MediaMetadata.Builder()
            .setTitle(o.optString("title"))
            .setArtist(o.optString("artist"))
            .setAlbumTitle(o.optString("album"))
            .setIsPlayable(true)
        val cover = o.optString("cover").takeIf { it.isNotEmpty() && it != "null" }
        if (cover != null) meta.setArtworkUri(Uri.parse(cover))
        else meta.setArtworkData(artwork(context).fallbackPng, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
        val duration = o.optDouble("duration", 0.0)
        if (duration > 0) meta.setDurationMs((duration * 1000).toLong())
        return MediaItem.Builder().setMediaId(o.optString("key")).setUri(o.optString("url")).setMediaMetadata(meta.build()).build()
    }

    private fun items(list: JSONArray?): List<MediaItem> = (0 until (list?.length() ?: 0)).map { itemOf(list!!.getJSONObject(it)) }

    /** A command of the page: `{ op, … }`; answers the player's state. */
    fun command(body: JSONObject): JSONObject = onMain {
        when (body.optString("op")) {
            "load" -> {
                val p = ready()
                val list = items(body.optJSONArray("items"))
                val index = body.optInt("index").coerceIn(0, maxOf(0, list.size - 1))
                lastKey = list.getOrNull(index)?.mediaId
                p.setMediaItems(list, index, (body.optDouble("from", 0.0) * 1000).toLong())
                p.prepare()
                p.play()
            }
            "window" -> {
                val p = player
                val list = items(body.optJSONArray("items"))
                val index = body.optInt("index")
                val current = p?.currentMediaItem
                if (p != null && current != null && list.getOrNull(index)?.mediaId == current.mediaId) {
                    // the current song goes on: the ones around it are swapped
                    val at = p.currentMediaItemIndex
                    if (at + 1 < p.mediaItemCount) p.removeMediaItems(at + 1, p.mediaItemCount)
                    if (at > 0) p.removeMediaItems(0, at)
                    if (index > 0) p.addMediaItems(0, list.subList(0, index))
                    if (index + 1 < list.size) p.addMediaItems(list.subList(index + 1, list.size))
                }
            }
            "play" -> player?.let { if (it.playbackState == Player.STATE_IDLE) it.prepare(); if (it.playbackState == Player.STATE_ENDED) it.seekTo(0); it.play() }
            "pause" -> player?.pause()
            "seek" -> player?.seekTo((body.optDouble("t", 0.0) * 1000).toLong())
            "volume" -> player?.volume = body.optDouble("v", 1.0).toFloat().coerceIn(0f, 1f)
            "clear" -> player?.let { it.stop(); it.clearMediaItems(); lastKey = null }
            "state" -> {}
            else -> throw IllegalArgumentException("¿Qué hago con el reproductor?")
        }
        state()
    }

    /** Where the player is: the song (its key), the second, whether it plays (the page asks when it wakes up). */
    private fun state(): JSONObject {
        val p = player ?: return JSONObject().put("loaded", false)
        return JSONObject()
            .put("loaded", p.mediaItemCount > 0)
            .put("key", p.currentMediaItem?.mediaId ?: JSONObject.NULL)
            .put("t", p.currentPosition / 1000.0)
            .put("d", if (p.duration == C.TIME_UNSET) 0 else p.duration / 1000.0)
            .put("playing", p.playWhenReady && p.playbackState != Player.STATE_ENDED)
            .put("ended", p.playbackState == Player.STATE_ENDED)
    }

    fun release() = main.post {
        controller?.release()
        controller = null
    }

    companion object {
        private const val TICK_MS = 500L
        /** one player for the whole app: the service shows it, the host commands it */
        @Volatile var player: ExoPlayer? = null
            private set

        private var art: Artwork? = null
        /** the covers for the system, with the app's icon when a song has none (see Artwork) */
        @androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
        fun artwork(context: Context): Artwork = art ?: Artwork(context.applicationContext).also { art = it }

        /** The service stopped (the app was closed while paused): the player goes with it. */
        fun drop() {
            player?.release()
            player = null
        }
    }
}
