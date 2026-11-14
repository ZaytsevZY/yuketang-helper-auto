package com.zaytsev.yuketanghelper.web

import android.webkit.CookieManager
import android.webkit.WebView
import com.zaytsev.yuketanghelper.model.BrowserCredentials
import com.zaytsev.yuketanghelper.model.Environment
import com.zaytsev.yuketanghelper.storage.SettingsStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

interface CredentialSource {
    suspend fun load(environment: Environment): BrowserCredentials
    fun saveBearerToken(environment: Environment, token: String?)
    fun captureCookies(environment: Environment, values: List<String>) {}
}

// Does not retain an Activity/WebView: background classroom sessions use the same cookie store.
class WebSessionCredentials(private val settings: SettingsStore) : CredentialSource {
    override suspend fun load(environment: Environment): BrowserCredentials = withContext(Dispatchers.Main) {
        val cookies = CookieManager.getInstance().getCookie(environment.origin).orEmpty()
        val userId = cookies.split(';').map(String::trim).firstOrNull { it.startsWith("user_id=") }?.substringAfter('=')
        BrowserCredentials(cookies, settings.bearerToken(environment.name), userId)
    }

    override fun saveBearerToken(environment: Environment, token: String?) {
        settings.saveBearerToken(environment.name, token?.removePrefix("Bearer "))
    }

    override fun captureCookies(environment: Environment, values: List<String>) {
        values.forEach { CookieManager.getInstance().setCookie(environment.origin, it) }
        if (values.isNotEmpty()) CookieManager.getInstance().flush()
    }

    suspend fun capturePage(webView: WebView, environment: Environment) = withContext(Dispatchers.Main) {
        val origin = runCatching { android.net.Uri.parse(webView.url).let { "${it.scheme}://${it.host}" } }.getOrNull()
        if (origin != environment.origin) return@withContext
        val token = withTimeoutOrNull(2000) {
            suspendCancellableCoroutine<String?> { continuation ->
                webView.evaluateJavascript("localStorage.getItem('Authorization')") { encoded ->
                    val value = runCatching {
                        if (encoded == "null") null else JSONObject("{\"v\":$encoded}").optString("v")
                    }.getOrNull()?.removePrefix("Bearer ")?.takeIf { it.isNotBlank() && it != "null" }
                    if (continuation.isActive) continuation.resume(value)
                }
            }
        }
        if (token != null) saveBearerToken(environment, token)
    }
}
