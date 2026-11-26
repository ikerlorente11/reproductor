package com.ikerlorente11.reproductor.host

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.media3.common.C
import androidx.media3.common.Player
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * The player on the home screen: what plays (its cover, its title and artist) and its buttons, without opening the
 * app. It can be made any size, and follows it (from the size the launcher says, on every resize):
 * - narrow: the cover and play/pause;
 * - wider: the song on the left half and previous/play/next on the right half, the progress bar at the bottom, over
 *   the cover; the buttons and the text grow with the widget (Android 12 on; before, they keep a middle size).
 * The buttons go to the player (Playback.control): with the app closed, ▶ starts the local server and plays on from
 * where it was left. Touching the cover or the song opens the app.
 */
class PlayerWidget : AppWidgetProvider() {
    // (a receiver's callbacks run on the main thread, where the player is read)
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = render(context, manager, ids)

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
        render(context, manager, intArrayOf(id))

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return super.onReceive(context, intent)
        val what = intent.getStringExtra(EXTRA) ?: return
        val app = context.applicationContext
        val pending = goAsync()
        // off the main thread: starting the server opens a socket (the player's own work is posted to the main thread)
        Thread {
            try { Host.ensure(app).playback.control(what) } catch (e: Exception) { Log.w("reproductor", "widget: ${e.message}") }
            finally { refresh(app); pending.finish() }
        }.start()
    }

    /** What the widget shows: the song playing (or the last one kept, with the app closed) and whether it plays. */
    private class Now(val title: String, val artist: String, val cover: String?, val playing: Boolean, val any: Boolean,
                      /** how much of the song was heard, in thousandths */
                      val progress: Int)

    companion object {
        private const val ACTION = "com.ikerlorente11.reproductor.host.WIDGET"
        private const val EXTRA = "do"
        private const val COVER_PX = 360

        private val main = Handler(Looper.getMainLooper())

        /** Shows the player as it is now on every widget there is (on the main thread: the player is read there only). */
        fun refresh(context: Context) {
            if (Looper.myLooper() != Looper.getMainLooper()) { main.post { refresh(context) }; return }
            val manager = AppWidgetManager.getInstance(context)
            val ids = try { manager.getAppWidgetIds(ComponentName(context, PlayerWidget::class.java)) } catch (_: Exception) { return }
            if (ids.isNotEmpty()) render(context, manager, ids)
        }

        private fun progressOf(p: Player): Int {
            val d = p.duration
            return if (d == C.TIME_UNSET || d <= 0) 0 else (p.currentPosition * 1000 / d).toInt().coerceIn(0, 1000)
        }

        /** Moves the progress bar only (every second while it plays): the rest, with its cover, is not sent again. */
        fun progress(context: Context) {
            val p = Playback.player ?: return
            val manager = AppWidgetManager.getInstance(context)
            val ids = try { manager.getAppWidgetIds(ComponentName(context, PlayerWidget::class.java)) } catch (_: Exception) { return }
            if (ids.isEmpty()) return
            val value = progressOf(p)
            for (id in ids) {
                val v = RemoteViews(context.packageName, layoutFor(manager.getAppWidgetOptions(id)))
                v.setProgressBar(R.id.rw_progress, 1000, value, false)
                try { manager.partiallyUpdateAppWidget(id, v) } catch (_: Exception) {}
            }
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val now = now(context)
            val cover = Covers.get(context, now.cover)
            for (id in ids) {
                val options = manager.getAppWidgetOptions(id)
                val views = build(context, layoutFor(options), now, cover)
                if (layoutFor(options) == R.layout.reproductor_widget_wide) fit(context, views, options)
                try { manager.updateAppWidget(id, views) } catch (e: Exception) { Log.w("reproductor", "widget: ${e.message}") }
            }
        }

        /** The layout for the size the launcher gives (dp; the portrait width and height), told again on every resize.
         *  Chosen here, not with Android 12's layouts by size: some launchers (MIUI's) do not pick among them. */
        private fun layoutFor(options: Bundle): Int {
            val w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)
            val h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 110)
            return if (w < 150) R.layout.reproductor_widget_small else R.layout.reproductor_widget_wide
        }

        /**
         * The wide layout sized to the widget: the buttons as big as the right half and the height let them (the play
         * button between 32 and 76 dp, the others ¾ of it), the title and artist with the height.
         */
        private fun fit(context: Context, v: RemoteViews, options: Bundle) {
            val w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250).toFloat()
            val h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 110).toFloat()
            val content = h - 35f                  // the paddings (10 + 12) and the progress bar with its margin (5 + 8)
            val half = (w - 32f) / 2f              // the side paddings (16 + 16)
            // three buttons: play, two of ¾, and two gaps of ⅕ of play
            val play = minOf(content, half / (1f + 2 * 0.75f + 2 * 0.2f)).coerceIn(32f, 76f)
            val side = play * 0.75f
            val title = (content * 0.18f).coerceIn(13f, 22f)
            v.setTextViewTextSize(R.id.rw_title, TypedValue.COMPLEX_UNIT_SP, title)
            v.setTextViewTextSize(R.id.rw_artist, TypedValue.COMPLEX_UNIT_SP, title * 0.8f)
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
            val px = context.resources.displayMetrics.density
            for ((id, size) in listOf(R.id.rw_play to play, R.id.rw_prev to side, R.id.rw_next to side)) {
                v.setViewLayoutWidth(id, size, TypedValue.COMPLEX_UNIT_DIP)
                v.setViewLayoutHeight(id, size, TypedValue.COMPLEX_UNIT_DIP)
                val pad = (size * (if (id == R.id.rw_play) 0.26f else 0.22f) * px).toInt()
                v.setViewPadding(id, pad, pad, pad, pad)
            }
            v.setViewLayoutMargin(R.id.rw_play, RemoteViews.MARGIN_START, play * 0.2f, TypedValue.COMPLEX_UNIT_DIP)
            v.setViewLayoutMargin(R.id.rw_play, RemoteViews.MARGIN_END, play * 0.2f, TypedValue.COMPLEX_UNIT_DIP)
        }

        private fun now(context: Context): Now {
            val p = Playback.player?.takeIf { it.mediaItemCount > 0 }
            val item = p?.currentMediaItem
            if (p != null && item != null) {
                val meta = item.mediaMetadata
                val playing = p.playWhenReady && p.playbackState != Player.STATE_ENDED
                return Now(meta.title?.toString() ?: "", meta.artist?.toString() ?: "", meta.artworkUri?.toString(), playing, true, progressOf(p))
            }
            val kept = context.getSharedPreferences("reproductor.playback", Context.MODE_PRIVATE)
            val title = kept.getString("title", null)
            val duration = kept.getLong("duration", 0)
            return Now(title ?: "", kept.getString("artist", null) ?: "", kept.getString("cover", null), false,
                       !title.isNullOrEmpty() && kept.getString("window", null) != null,
                       if (duration > 0) (kept.getLong("ms", 0) * 1000 / duration).toInt().coerceIn(0, 1000) else 0)
        }

        private fun build(context: Context, layout: Int, now: Now, cover: Bitmap?): RemoteViews {
            val v = RemoteViews(context.packageName, layout)
            if (cover != null) {
                v.setImageViewBitmap(R.id.rw_cover, cover)
                v.setViewVisibility(R.id.rw_cover, View.VISIBLE)
                v.setViewVisibility(R.id.rw_cover_none, View.GONE)
            } else {
                v.setViewVisibility(R.id.rw_cover, View.INVISIBLE)
                // wide, the card is plain; narrow, the app's note
                v.setViewVisibility(R.id.rw_cover_none, if (layout == R.layout.reproductor_widget_wide) View.GONE else View.VISIBLE)
            }
            v.setProgressBar(R.id.rw_progress, 1000, now.progress, false)
            v.setImageViewResource(R.id.rw_play, if (now.playing) R.drawable.reproductor_widget_pause else R.drawable.reproductor_widget_play)
            v.setContentDescription(R.id.rw_play, context.getString(if (now.playing) R.string.reproductor_widget_pause else R.string.reproductor_widget_play))
            v.setOnClickPendingIntent(R.id.rw_play, control(context, "toggle"))
            v.setOnClickPendingIntent(R.id.rw_root, open(context))
            if (layout != R.layout.reproductor_widget_small) {
                v.setTextViewText(R.id.rw_title, now.title.ifEmpty { context.getString(R.string.reproductor_widget_label) })
                v.setTextViewText(R.id.rw_artist, when {
                    !now.any -> context.getString(R.string.reproductor_widget_empty)
                    now.artist.isNotEmpty() -> now.artist
                    else -> ""
                })
                v.setOnClickPendingIntent(R.id.rw_prev, control(context, "prev"))
                v.setOnClickPendingIntent(R.id.rw_next, control(context, "next"))
            }
            if (layout == R.layout.reproductor_widget_wide) v.setOnClickPendingIntent(R.id.rw_open, open(context))
            return v
        }

        private fun control(context: Context, what: String): PendingIntent {
            val intent = Intent(context, PlayerWidget::class.java).setAction(ACTION).putExtra(EXTRA, what)
            return PendingIntent.getBroadcast(context, what.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun open(context: Context): PendingIntent? {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                ?: return null
            return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }

    /**
     * The cover the widget shows, kept in a file: with the app closed its URL (the local server's, with an old token)
     * no longer answers, but the file does. A new one is fetched in the background, and the widget shown again.
     */
    private object Covers {
        private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
        @Volatile private var url: String? = null
        @Volatile private var bitmap: Bitmap? = null
        @Volatile private var fetching: String? = null

        fun get(context: Context, cover: String?): Bitmap? {
            if (cover.isNullOrEmpty()) return null
            if (cover == url) return bitmap
            val file = File(context.filesDir, "widget-cover")
            val prefs = context.getSharedPreferences("reproductor.widget", Context.MODE_PRIVATE)
            if (prefs.getString("cover", null) == cover && file.exists()) {
                BitmapFactory.decodeFile(file.path)?.let { url = cover; bitmap = it; return it }
            }
            if (fetching != cover) {
                fetching = cover
                val app = context.applicationContext
                Thread {
                    try {
                        // the local server's, kept with the token it had: with the one it has now
                        val from = Host.running()?.let { Playback.rebase(cover, "http://127.0.0.1:${it.listeningPort}", it.token) } ?: cover
                        val bytes = client.newCall(Request.Builder().url(from).build()).execute().use { if (it.isSuccessful) it.body?.bytes() else null }
                        val scaled = bytes?.let { scaled(it) }
                        if (scaled != null && fetching == cover) {
                            file.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 88, it) }
                            prefs.edit().putString("cover", cover).apply()
                            url = cover
                            bitmap = scaled
                            refresh(app)
                        }
                    } catch (e: Exception) { Log.w("reproductor", "widget: portada: ${e.message}") }
                    finally { if (fetching == cover) fetching = null }
                }.start()
            }
            return null
        }

        /** No bigger than COVER_PX a side: the widget's pictures travel to the launcher, which limits their size. */
        private fun scaled(bytes: ByteArray): Bitmap? {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= COVER_PX && bounds.outHeight / (sample * 2) >= COVER_PX) sample *= 2
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
            val side = maxOf(decoded.width, decoded.height)
            if (side <= COVER_PX) return decoded
            val k = COVER_PX.toFloat() / side
            return Bitmap.createScaledBitmap(decoded, (decoded.width * k).toInt(), (decoded.height * k).toInt(), true)
        }
    }
}
