package com.ikerlorente11.reproductor.host

import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
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
 *
 * Where it is (the song and the second) is also kept here, on the phone's storage, as it plays: the page sleeps while
 * the screen is off, and if Android closes the app meanwhile the page would only know where it was when it last woke.
 * Opened again, the page asks (`state` → `saved`) and goes on from there.
 *
 * The window of the queue is kept too, so the widget (PlayerWidget) plays on with the app closed: `resume` loads it
 * again with this server's address and token (`here`), at the song and second kept. Every change is shown on it.
 */
class Playback(private val context: Context, private val events: Events, private val here: () -> Pair<String, String>) {
    private val main = Handler(Looper.getMainLooper())
    private var controller: MediaController? = null
    private var lastKey: String? = null
    private val kept: SharedPreferences = context.getSharedPreferences("reproductor.playback", Context.MODE_PRIVATE)
    private var ticks = 0
    private val ticker = object : Runnable {
        override fun run() {
            val p = player ?: return
            if (p.isPlaying) {
                if (pastSound(p)) return
                send("time", JSONObject().put("t", p.currentPosition / 1000.0))
                if (++ticks % KEEP_EVERY == 0) keep()
                if (ticks % WIDGET_EVERY == 0) PlayerWidget.progress(context)
                main.postDelayed(this, TICK_MS)
            }
        }
    }

    /** Keeps where the player is (its song, its second, and when; what the widget shows of it), to go on from there if
     *  the app is closed. */
    private fun keep(ms: Long? = null) {
        val p = player ?: return
        val item = p.currentMediaItem ?: return
        val meta = item.mediaMetadata
        kept.edit().putString("key", item.mediaId).putLong("ms", ms ?: p.currentPosition).putLong("at", System.currentTimeMillis())
            .putString("title", meta.title?.toString() ?: "").putString("artist", meta.artist?.toString() ?: "")
            .putString("cover", meta.artworkUri?.toString())
            .putLong("duration", if (p.duration == C.TIME_UNSET) 0 else p.duration).apply()
    }

    /** The widget shows what changed. */
    private fun shown() = main.post { PlayerWidget.refresh(context) }

    // ---- the volume the page chose, the speed, and the sleep timer (done here: the page sleeps with the screen off) ----
    private var volume = 1f
    private var speed = 1f
    /** the sleep timer's fading out (1: not fading) */
    private var fade = 1f

    // ---- each song's sound (the page measures it: analysis.ts): its gain and where its sound starts and ends ----
    private class Sound(val gain: Double, val startMs: Long, val endMs: Long)
    private val sounds = HashMap<String, Sound>()
    /** raises a song (the volume can only lower it), on the player's audio session */
    private var enhancer: LoudnessEnhancer? = null
    private fun soundOf(key: String?) = key?.let { sounds[it] }

    /** The player's volume: the page's, the song's gain (if it lowers it) and the timer's fading; a gain that raises it,
     *  on the enhancer. */
    private fun applyVolume() {
        val p = player ?: return
        val gain = soundOf(p.currentMediaItem?.mediaId)?.gain ?: 0.0
        p.volume = (volume * Math.pow(10.0, minOf(0.0, gain) / 20).toFloat() * fade).coerceIn(0f, 1f)
        val e = enhancer ?: return
        val raise = maxOf(0.0, gain) + boost
        try {
            e.setTargetGain((raise * 100).toInt())
            e.enabled = raise > 0
        } catch (_: Exception) {}
    }

    // ---- the equaliser (the system's, on the player's session: its own bands) and the extra volume ----
    private var equalizer: Equalizer? = null
    /** the page's ten bands (dB, at BANDS); null: off */
    private var eqBands: DoubleArray? = null
    /** raised beyond the maximum (dB), on the enhancer */
    private var boost = 0.0

    /** Each of the system's bands takes what the page's say at its own frequency (between two of them, in proportion,
     *  on a log scale), within what the system allows. */
    private fun applyEq() {
        val e = equalizer ?: return
        val bands = eqBands
        try {
            if (bands == null) { e.enabled = false; return }
            val (low, high) = e.bandLevelRange.let { it[0].toInt() to it[1].toInt() }
            for (b in 0 until e.numberOfBands.toInt()) {
                val hz = e.getCenterFreq(b.toShort()) / 1000.0
                e.setBandLevel(b.toShort(), (at(bands, hz) * 100).toInt().coerceIn(low, high).toShort())
            }
            e.enabled = true
        } catch (_: Exception) {}
    }
    private fun at(bands: DoubleArray, hz: Double): Double {
        val x = Math.log(hz)
        if (x <= Math.log(BANDS[0])) return bands[0]
        for (i in 1 until BANDS.size) {
            val a = Math.log(BANDS[i - 1])
            val b = Math.log(BANDS[i])
            if (x <= b) return bands[i - 1] + (bands[i] - bands[i - 1]) * (x - a) / (b - a)
        }
        return bands.last()
    }

    // ---- where it sounds (the phone's speaker, wired headphones, a Bluetooth device): the page keeps a setting for each ----
    private val audioManager by lazy { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private var output: Pair<String, String> = "" to ""
    private fun currentOutput(): Pair<String, String> {
        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        val bt = setOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, 26 /* BLE_HEADSET */, 27 /* BLE_SPEAKER */)
        val wired = setOf(AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET)
        devices.firstOrNull { it.type in bt }?.let { val name = it.productName?.toString()?.takeIf { n -> n.isNotBlank() } ?: "Bluetooth"; return "bt:$name" to name }
        devices.firstOrNull { it.type in wired }?.let { return "wired" to "Auriculares con cable" }
        return "speaker" to "Altavoz del móvil"
    }
    private fun outputChanged() {
        val now = currentOutput()
        if (now == output) return
        output = now
        send("output", JSONObject().put("key", now.first).put("name", now.second))
    }
    private val devicesCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) { outputChanged() }
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) { outputChanged() }
    }
    init {
        main.post {
            try { audioManager.registerAudioDeviceCallback(devicesCallback, main); output = currentOutput() } catch (_: Exception) {}
        }
    }

    /** The song's sound ended (its silence after it skipped): the next one, or the end (the page says what comes next). */
    private fun pastSound(p: ExoPlayer): Boolean {
        val end = soundOf(p.currentMediaItem?.mediaId)?.endMs ?: 0
        if (end <= 0 || p.currentPosition < end) return false
        when {
            sleepEndOfSong -> { p.pause(); endSleep(); send("slept", JSONObject()) }
            p.hasNextMediaItem() -> p.seekToNextMediaItem()
            else -> { p.pause(); send("ended", JSONObject()) }
        }
        return true
    }
    /** it stops at this time (ms since 1970; 0: no), or at the end of the song playing */
    private var sleepAt = 0L
    private var sleepEndOfSong = false
    private var sleepFadeMs = 10_000L
    private val sleeping get() = sleepAt > 0 || sleepEndOfSong
    private val sleeper = object : Runnable {
        override fun run() {
            sleepTick()
            if (sleeping) main.postDelayed(this, SLEEP_TICK_MS)
        }
    }

    /** Fades out the last seconds; at its time, pauses (at the end of the song the player pauses itself: `pauseAtEnd…`). */
    private fun sleepTick() {
        val p = player ?: return
        val left = when {
            sleepAt > 0 -> sleepAt - System.currentTimeMillis()
            sleepEndOfSong && p.duration != C.TIME_UNSET ->
                (((soundOf(p.currentMediaItem?.mediaId)?.endMs?.takeIf { it > 0 } ?: p.duration) - p.currentPosition) / p.playbackParameters.speed).toLong()
            else -> return
        }
        if (sleepAt > 0 && left <= 0) {
            p.pause()
            endSleep()
            send("slept", JSONObject())
            return
        }
        fade = if (p.isPlaying && left < sleepFadeMs) (left.toFloat() / sleepFadeMs).coerceIn(0f, 1f) else 1f
        applyVolume()
    }

    private fun endSleep() {
        main.removeCallbacks(sleeper)
        sleepAt = 0
        sleepEndOfSong = false
        fade = 1f
        player?.pauseAtEndOfMediaItems = false
        applyVolume()
    }

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val p = player ?: return
            // a pause the player makes itself while loading (buffering) is not the person's
            if (!isPlaying && p.playWhenReady && p.playbackState == Player.STATE_BUFFERING) return
            send(if (isPlaying || p.playWhenReady) "play" else "pause", JSONObject().put("t", p.currentPosition / 1000.0))
            keep()
            shown()
            main.removeCallbacks(ticker)
            if (isPlaying) main.post(ticker)
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            val p = player ?: return
            // the sleep timer at the end of the song: it paused there (▶ goes on with the next one)
            if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM && sleepEndOfSong) {
                endSleep()
                send("slept", JSONObject())
            }
            if (!playWhenReady) { send("pause", JSONObject().put("t", p.currentPosition / 1000.0)); keep() }
            shown()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val key = mediaItem?.mediaId ?: return
            if (key == lastKey && reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) return
            lastKey = key
            applyVolume()
            val start = soundOf(key)?.startMs ?: 0
            if (start > 0 && (player?.currentPosition ?: 0) < start) player?.seekTo(start)
            keep(0)
            shown()
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
            .also {
                player = it
                it.addListener(listener)
                it.setPlaybackSpeed(speed)
                try {
                    val session = (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).generateAudioSessionId()
                    it.audioSessionId = session
                    enhancer?.release()
                    enhancer = LoudnessEnhancer(session)
                    equalizer?.release()
                    equalizer = try { Equalizer(0, session) } catch (_: Exception) { null }
                    applyEq()
                } catch (_: Exception) { enhancer = null }
                applyVolume()
            }
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
        sounds[o.optString("key")] = Sound(o.optDouble("gain", 0.0), (o.optDouble("start", 0.0) * 1000).toLong(), (o.optDouble("end", 0.0) * 1000).toLong())
        return MediaItem.Builder().setMediaId(o.optString("key")).setUri(o.optString("url")).setMediaMetadata(meta.build()).build()
    }

    /** A window's songs (the sounds kept are the window's: those of songs that left it go) */
    private fun items(list: JSONArray?): List<MediaItem> {
        sounds.clear()
        return (0 until (list?.length() ?: 0)).map { itemOf(list!!.getJSONObject(it)) }
    }

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
                keep((body.optDouble("from", 0.0) * 1000).toLong())
                keepWindow(body.optJSONArray("items"))
                shown()
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
                    keepWindow(body.optJSONArray("items"))
                    applyVolume()
                    val start = soundOf(current.mediaId)?.startMs ?: 0
                    if (start > 0 && p.currentPosition < minOf(start, 3000)) p.seekTo(start)
                }
            }
            "play" -> player?.let { if (it.playbackState == Player.STATE_IDLE) it.prepare(); if (it.playbackState == Player.STATE_ENDED) it.seekTo(0); it.play() }
            "pause" -> player?.pause()
            "seek" -> player?.let { val ms = (body.optDouble("t", 0.0) * 1000).toLong(); it.seekTo(ms); keep(ms); shown() }
            "volume" -> { volume = body.optDouble("v", 1.0).toFloat().coerceIn(0f, 1f); applyVolume(); if (sleeping) sleepTick() }
            "eq" -> {
                val list = body.optJSONArray("bands")
                eqBands = list?.let { l -> DoubleArray(l.length()) { l.optDouble(it, 0.0) } }
                applyEq()
            }
            "boost" -> { boost = body.optDouble("db", 0.0).coerceIn(0.0, 12.0); applyVolume() }
            "rate" -> { speed = body.optDouble("r", 1.0).toFloat().coerceIn(0.25f, 3f); player?.setPlaybackSpeed(speed) }
            "sleep" -> {
                endSleep()
                val at = body.optLong("at", 0)
                val endOfSong = body.optBoolean("endOfSong", false)
                if (at > 0 || endOfSong) {
                    sleepAt = at
                    sleepEndOfSong = endOfSong
                    sleepFadeMs = (body.optDouble("fade", 10.0) * 1000).toLong()
                    player?.pauseAtEndOfMediaItems = endOfSong
                    main.post(sleeper)
                }
            }
            "clear" -> player?.let { endSleep(); it.stop(); it.clearMediaItems(); lastKey = null; shown() }
            "state" -> {}
            else -> throw IllegalArgumentException("¿Qué hago con el reproductor?")
        }
        state()
    }

    /** The songs the page handed (as it sent them), to play them again with the app closed. */
    private fun keepWindow(items: JSONArray?) {
        if (items != null) kept.edit().putString("window", items.toString()).apply()
    }


    /**
     * Plays on (the widget's ▶): the player as it is, or, with nothing loaded (the app was closed), the window of the
     * queue kept, at the song and second kept. False when there is nothing to play (the page never handed any).
     */
    fun resume(): Boolean = onMain {
        val loaded = player?.takeIf { it.mediaItemCount > 0 }
        if (loaded != null) {
            if (loaded.playbackState == Player.STATE_IDLE) loaded.prepare()
            if (loaded.playbackState == Player.STATE_ENDED) loaded.seekTo(0)
            loaded.play()
            return@onMain true
        }
        val window = kept.getString("window", null)?.let { try { JSONArray(it) } catch (_: Exception) { null } }
        if (window == null || window.length() == 0) return@onMain false
        val (base, token) = here()
        for (i in 0 until window.length()) {
            val o = window.getJSONObject(i)
            o.put("url", rebase(o.optString("url"), base, token))
            o.optString("cover").takeIf { it.isNotEmpty() && it != "null" }?.let { o.put("cover", rebase(it, base, token)) }
        }
        val list = items(window)
        val key = kept.getString("key", null)
        val at = list.indexOfFirst { it.mediaId == key }
        val p = ready()
        lastKey = list[maxOf(0, at)].mediaId
        p.setMediaItems(list, maxOf(0, at), if (at >= 0) kept.getLong("ms", 0) else 0)
        p.prepare()
        p.play()
        true
    }

    /** A button of the widget: `toggle` (play/pause, or play on what was left), `next`, `prev`. */
    fun control(action: String) {
        onMain {
            val p = player?.takeIf { it.mediaItemCount > 0 }
            when (action) {
                "toggle" -> if (p == null) resume() else if (p.playWhenReady) p.pause() else resume()
                "next" -> p?.let { if (it.hasNextMediaItem()) it.seekToNextMediaItem() }
                "prev" -> p?.let { if (it.currentPosition > 3000 || !it.hasPreviousMediaItem()) it.seekTo(0) else it.seekToPreviousMediaItem() }
            }
        }
    }

    /** Where the player is: the song (its key), the second, whether it plays (the page asks when it wakes up); and where
     *  it was last kept (`saved`: its song, second and when, in ms since 1970), for a page opened after the app was closed. */
    private fun state(): JSONObject {
        val saved = kept.getString("key", null)?.let {
            JSONObject().put("key", it).put("t", kept.getLong("ms", 0) / 1000.0).put("at", kept.getLong("at", 0))
        } ?: JSONObject.NULL
        // what this side knows how to do (an older app, whose page came newer in an update, does not)
        val features = JSONArray().put("sleep").put("rate").put("eq").put("boost").put("output")
        val out = JSONObject().put("key", output.first).put("name", output.second)
        val p = player ?: return JSONObject().put("loaded", false).put("saved", saved).put("features", features).put("sleeping", sleeping).put("output", out)
        return JSONObject()
            .put("features", features)
            .put("output", out)
            .put("sleeping", sleeping)
            .put("saved", saved)
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
        /** the page's equaliser bands (Hz): eq.ts's BANDS */
        private val BANDS = doubleArrayOf(32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)
        /** how often the sleep timer looks at the time left (and fades out) */
        private const val SLEEP_TICK_MS = 250L
        /** where it is is kept every this many ticks while it plays (5 s) */
        private const val KEEP_EVERY = 10
        /** the widget's progress bar moves every this many ticks (1 s) */
        private const val WIDGET_EVERY = 2
        /** one player for the whole app: the service shows it, the host commands it */
        @Volatile var player: ExoPlayer? = null
            private set

        private var art: Artwork? = null
        /** the covers for the system, with the app's icon when a song has none (see Artwork) */
        @androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
        fun artwork(context: Context): Artwork = art ?: Artwork(context.applicationContext).also { art = it }

        /** A URL of the local server as it was when kept (another port, another token): the server's now. */
        fun rebase(url: String, base: String, token: String): String {
            if (!url.startsWith("http://127.0.0.1:")) return url
            val path = url.substring(url.indexOf('/', "http://".length).takeIf { it > 0 } ?: url.length)
            return base + path.replace(Regex("([?&])t=[0-9A-Fa-f]+"), "$1t=$token")
        }

        /** The service stopped (the app was closed while paused): the player goes with it. */
        fun drop() {
            player?.release()
            player = null
        }
    }
}
