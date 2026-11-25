package com.ikerlorente11.reproductor.host

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import java.io.ByteArrayOutputStream

/**
 * The covers the system shows (notification, lock screen). Without one, Android draws the player see-through and
 * its buttons get lost on the wallpaper: a song with no cover, or one that cannot be loaded (the cloud's, offline),
 * shows the app's icon on its green instead.
 */
@UnstableApi
class Artwork(context: Context) : BitmapLoader {
    private val inner = DataSourceBitmapLoader(context)

    /** the app's icon on its green, square (made once) */
    val fallback: Bitmap by lazy {
        val size = 512
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(0x1f, 0xb8, 0x66))
        context.packageManager.getApplicationIcon(context.applicationInfo).let { icon ->
            icon.setBounds(0, 0, size, size)
            icon.draw(canvas)
        }
        bitmap
    }

    /** the same, as PNG bytes, for the songs that bring no cover */
    val fallbackPng: ByteArray by lazy {
        ByteArrayOutputStream().also { fallback.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    override fun supportsMimeType(mimeType: String): Boolean = inner.supportsMimeType(mimeType)

    override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = orFallback(inner.decodeBitmap(data))

    override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> = orFallback(inner.loadBitmap(uri))

    private fun orFallback(future: ListenableFuture<Bitmap>): ListenableFuture<Bitmap> =
        Futures.catching(future, Throwable::class.java, { fallback }, MoreExecutors.directExecutor())
}
