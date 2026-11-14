package com.zaytsev.yuketanghelper.web

import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.zaytsev.yuketanghelper.model.Environment
import com.zaytsev.yuketanghelper.session.ClassroomSession
import org.json.JSONObject

/** Origin-scoped, main-frame, receive-only data bridge; never exposes tokens or native commands. */
class ClassroomObserver(private val webView: WebView, private val session: ClassroomSession) {
    private val script = webView.context.assets.open("classroom-observer.js").bufferedReader().use { it.readText() }
    private var documentStart = false
    private var listenerAvailable = false
    fun install() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        listenerAvailable = true
        val origins = Environment.entries.map { it.origin }.toSet()
        WebViewCompat.addWebMessageListener(webView, "YktClassroom", origins) { _, message, origin, mainFrame, _ ->
            if (!mainFrame || origin.toString().trimEnd('/') != session.state.environment.origin) return@addWebMessageListener
            val text = message.data ?: return@addWebMessageListener
            if (text.length > 4 * 1024 * 1024) return@addWebMessageListener
            val value = runCatching { JSONObject(text) }.getOrNull() ?: return@addWebMessageListener
            session.observeBrowser(value)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, script, origins)
            documentStart = true
        }
    }
    fun pageStarted(url: String?) {
        if (!documentStart && listenerAvailable && Environment.entries.any { url?.startsWith(it.origin + "/") == true }) {
            webView.evaluateJavascript(script, null)
        }
    }
}
