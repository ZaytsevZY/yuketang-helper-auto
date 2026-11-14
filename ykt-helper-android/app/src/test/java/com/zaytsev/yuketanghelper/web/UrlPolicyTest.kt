package com.zaytsev.yuketanghelper.web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlPolicyTest {
    @Test
    fun acceptsOnlyHttpsYuketangHosts() {
        assertTrue(UrlPolicy.isAllowed("https://www.yuketang.cn/web"))
        assertTrue(UrlPolicy.isAllowed("https://school.yuketang.cn/path"))
        assertFalse(UrlPolicy.isAllowed("http://www.yuketang.cn/web"))
        assertFalse(UrlPolicy.isAllowed("https://yuketang.cn.example.com/web"))
        assertFalse(UrlPolicy.isAllowed("javascript:alert(1)"))
    }

    @Test
    fun detectsExternalSchemes() {
        assertTrue(UrlPolicy.isExternalScheme("weixin://login"))
        assertFalse(UrlPolicy.isExternalScheme("https://www.yuketang.cn"))
    }
}
