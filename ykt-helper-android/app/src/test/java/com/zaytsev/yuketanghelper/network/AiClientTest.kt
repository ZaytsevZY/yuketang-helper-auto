package com.zaytsev.yuketanghelper.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AiClientTest {
    @Test
    fun buildsOpenAiCompatibleEndpoints() {
        assertEquals(
            "https://api.example.com/v1/chat/completions",
            AiClient.endpoint("https://api.example.com/v1/", "chat/completions"),
        )
    }

    @Test
    fun rejectsNonHttpEndpoints() {
        assertThrows(IllegalArgumentException::class.java) {
            AiClient.endpoint("http://insecure.example.com/v1", "models")
        }
    }
}
