package com.zaytsev.yuketanghelper.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.widget.ImageView
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import com.zaytsev.yuketanghelper.network.awaitResponse

object SlideImages {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()
    private val cache = object : LruCache<String, Bitmap>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    suspend fun bytes(url: String): ByteArray = withContext(Dispatchers.IO) {
        require(url.startsWith("https://")) { "图片地址必须使用 HTTPS" }
        http.newCall(Request.Builder().url(url).build()).awaitResponse().use { response ->
            check(response.isSuccessful) { "课件图片下载失败" }
            val body = response.body ?: error("图片内容为空")
            check(body.contentLength() <= 16 * 1024 * 1024) { "图片过大" }
            body.byteStream().use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val n = input.read(buffer); if (n < 0) break
                    check(output.size() + n <= 16 * 1024 * 1024) { "图片过大" }
                    output.write(buffer, 0, n)
                }
                output.toByteArray()
            }
        }
    }
    fun load(view: ImageView, url: String) {
        cache.get(url)?.let { view.setImageBitmap(it); return }
        val job = scope.launch {
            try {
                val bitmap = withContext(Dispatchers.IO) {
                    val data = bytes(url)
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
                    val options = BitmapFactory.Options().apply {
                        inSampleSize = 1
                        while (bounds.outWidth / inSampleSize > 1600 || bounds.outHeight / inSampleSize > 1600) inSampleSize *= 2
                    }
                    BitmapFactory.decodeByteArray(data, 0, data.size, options) ?: error("无法解析图片")
                }
                cache.put(url, bitmap); view.setImageBitmap(bitmap)
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { view.contentDescription = "课件图片加载失败，可重新同步课堂" }
        }
        view.addOnAttachStateChangeListener(object : android.view.View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: android.view.View) = Unit
            override fun onViewDetachedFromWindow(v: android.view.View) { job.cancel(); v.removeOnAttachStateChangeListener(this) }
        })
    }
}
