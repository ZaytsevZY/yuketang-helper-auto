package com.zaytsev.yuketanghelper.web

import java.net.URI

object UrlPolicy {
    fun isAllowed(url: String): Boolean = runCatching {
        val uri = URI(url)
        val host = uri.host?.lowercase() ?: return false
        uri.scheme.equals("https", ignoreCase = true) &&
            (host == "yuketang.cn" || host.endsWith(".yuketang.cn"))
    }.getOrDefault(false)

    fun isExternalScheme(url: String): Boolean = runCatching {
        URI(url).scheme?.lowercase() !in setOf("http", "https")
    }.getOrDefault(false)
}
