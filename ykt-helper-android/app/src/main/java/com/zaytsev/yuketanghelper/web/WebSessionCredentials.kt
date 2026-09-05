package com.zaytsev.yuketanghelper.web

import android.webkit.CookieManager
import android.webkit.WebView
import com.zaytsev.yuketanghelper.model.BrowserCredentials
import com.zaytsev.yuketanghelper.model.Environment
import com.zaytsev.yuketanghelper.storage.SettingsStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.coroutines.resume

class WebSessionCredentials(
    private val webView: WebView,
    private val settings: SettingsStore,
) {
    suspend fun load(environment: Environment): BrowserCredentials = withContext(Dispatchers.Main) {
        val cookies = CookieManager.getInstance().getCookie(environment.origin).orEmpty()
        val userId = cookies.split(';')
            .map(String::trim)
            .firstOrNull { it.startsWith("user_id=") }
            ?.substringAfter('=')
        val pageToken = readAuthorization(environment)
        if (!pageToken.isNullOrBlank()) settings.saveBearerToken(environment.name, pageToken)
        BrowserCredentials(
            cookieHeader = cookies,
            bearerToken = pageToken ?: settings.bearerToken(environment.name),
            userId = userId,
        )
    }

    fun saveBearerToken(environment: Environment, token: String?) {
        settings.saveBearerToken(environment.name, token?.removePrefix("Bearer "))
    }

    private suspend fun readAuthorization(environment: Environment): String? {
        val currentOrigin = runCatching { android.net.Uri.parse(webView.url).let { "${it.scheme}://${it.host}" } }.getOrNull()
        if (currentOrigin != environment.origin) return null
        return suspendCancellableCoroutine { continuation ->
            webView.evaluateJavascript("localStorage.getItem('Authorization')") { encoded ->
                val value = runCatching {
                    if (encoded == "null") null else JSONObject("{\"v\":$encoded}").optString("v")
                }.getOrNull()?.removePrefix("Bearer ")?.takeIf(String::isNotBlank)
                if (continuation.isActive) continuation.resume(value)
            }
        }
    }
}
