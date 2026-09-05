package com.zaytsev.yuketanghelper.network

import com.zaytsev.yuketanghelper.answer.AnswerParser
import com.zaytsev.yuketanghelper.model.AiAnswer
import com.zaytsev.yuketanghelper.model.AiProfile
import com.zaytsev.yuketanghelper.model.Problem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class AiClient(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(75, TimeUnit.SECONDS)
        .build(),
) {
    suspend fun test(profile: AiProfile): List<String> = withContext(Dispatchers.IO) {
        val request = authorized(profile, endpoint(profile.baseUrl, "models")).get().build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) error("模型连接失败：HTTP ${response.code}")
            val data = JSONObject(text).optJSONArray("data") ?: JSONArray()
            buildList {
                for (index in 0 until data.length()) {
                    data.optJSONObject(index)?.optString("id")?.takeIf(String::isNotBlank)?.let(::add)
                }
            }
        }
    }

    suspend fun answerProblem(profile: AiProfile, problem: Problem, slideImage: String?): AiAnswer {
        val options = problem.options.mapIndexed { index, text -> "${'A' + index}. $text" }.joinToString("\n")
        val prompt = """
            请根据题目与可见课件内容作答。不要猜测不可见信息。
            题型：${problem.type}
            题目：${problem.prompt.ifBlank { "题干可能位于课件图片中" }}
            选项：
            $options

            严格输出：
            答案: <答案>
            解释: <简短依据>
        """.trimIndent()
        return AnswerParser.aiResponse(complete(profile, prompt, slideImage))
    }

    suspend fun askCourseware(profile: AiProfile, question: String, slideImage: String?): String {
        require(question.isNotBlank()) { "请输入关于课件的问题" }
        return complete(
            profile,
            "请只依据提供的课件页面回答；若信息不足请明确说明。问题：${question.trim()}",
            slideImage,
        )
    }

    private suspend fun complete(profile: AiProfile, prompt: String, imageUrl: String?): String = withContext(Dispatchers.IO) {
        val content: Any = if (imageUrl.isNullOrBlank()) {
            prompt
        } else {
            JSONArray()
                .put(JSONObject().put("type", "text").put("text", prompt))
                .put(
                    JSONObject().put("type", "image_url").put(
                        "image_url",
                        JSONObject().put("url", imageUrl),
                    ),
                )
        }
        val payload = JSONObject()
            .put("model", if (imageUrl.isNullOrBlank()) profile.model else profile.visionModel)
            .put("temperature", 1)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", content)))
        val request = authorized(profile, endpoint(profile.baseUrl, "chat/completions"))
            .post(payload.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) error("AI 请求失败：HTTP ${response.code}")
            JSONObject(text).optJSONArray("choices")
                ?.optJSONObject(0)
                ?.optJSONObject("message")
                ?.optString("content")
                ?.takeIf(String::isNotBlank)
                ?: error("AI 没有返回文本")
        }
    }

    private fun authorized(profile: AiProfile, url: String): Request.Builder = Request.Builder()
        .url(url)
        .header("authorization", "Bearer ${profile.apiKey}")
        .header("accept", "application/json")

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun endpoint(baseUrl: String, path: String): String {
            val base = baseUrl.trim().trimEnd('/')
            require(base.startsWith("https://")) { "Base URL 必须使用 HTTPS" }
            return "$base/$path"
        }
    }
}
