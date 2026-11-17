package com.zaytsev.yuketanghelper.web

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebViewDatabase
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewFeature

/** Call after destroying the old WebView so its scripts cannot recreate account data. */
object BrowserDataCleaner {
    @Suppress("DEPRECATION")
    fun clear(context: Context, onComplete: () -> Unit) {
        WebViewDatabase.getInstance(context.applicationContext).apply {
            clearFormData()
            clearHttpAuthUsernamePassword()
        }
        val storage = WebStorage.getInstance()
        val cookies = CookieManager.getInstance()
        fun clearCookies() {
            // Wait for completion before creating a new login page, then persist removal.
            cookies.removeAllCookies {
                cookies.flush()
                onComplete()
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
            WebStorageCompat.deleteBrowsingData(storage) { clearCookies() }
        } else {
            storage.deleteAllData()
            clearCookies()
        }
    }
}
