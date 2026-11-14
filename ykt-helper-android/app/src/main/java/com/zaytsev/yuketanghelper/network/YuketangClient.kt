package com.zaytsev.yuketanghelper.network

import com.zaytsev.yuketanghelper.answer.AnswerParser
import com.zaytsev.yuketanghelper.model.*
import com.zaytsev.yuketanghelper.web.CredentialSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class YuketangClient(
    private val credentials: CredentialSource,
    private val http: OkHttpClient = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS).callTimeout(45, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS).followRedirects(false).retryOnConnectionFailure(false).build(),
    private val origin: (Environment) -> String = { it.origin },
) {
    private val lessonTokens = mutableMapOf<String, String>()
    private var socket: WebSocket? = null
    @Volatile private var generation = 0L

    suspend fun listLessons(environment: Environment): List<Lesson> = YuketangParser.lessons(
        request(environment, "/api/v3/classroom/on-lesson"))

    suspend fun checkin(environment: Environment, lesson: Lesson) {
        val body = JSONObject().put("source", 5).put("lessonId", lesson.id).apply { lesson.classroomId?.let { put("classroomId", it) } }
        lessonTokens[lesson.id] = YuketangParser.lessonToken(request(environment, "/api/v3/lesson/checkin", body = body))
    }

    suspend fun fetchPresentation(environment: Environment, lessonId: String, id: String): Presentation {
        val encoded = java.net.URLEncoder.encode(id, "UTF-8")
        return YuketangParser.presentation(request(environment, "/api/v3/lesson/presentation/fetch?presentation_id=$encoded", lessonId = lessonId), lessonId, id)
    }

    suspend fun submitAnswer(environment: Environment, problem: Problem, input: String, forceRetry: Boolean = false) {
        val normalized = AnswerParser.normalized(problem, input) ?: error("答案格式不匹配，请检查选项范围或填空数量")
        val result: Any = if (problem.type == ProblemType.SUBJECTIVE) JSONObject()
            .put("content", normalized.first()).put("pics", JSONArray().put(JSONObject().put("pic", ""))).put("videos", JSONArray())
            else JSONArray(normalized)
        for (attempt in 0..1) {
            val now = System.currentTimeMillis()
            if (!forceRetry) {
                require(problem.unlockedAt != null && !problem.answered) { "题目未解锁或已经作答" }
                require(problem.deadlineAt?.let { it > now } != false) { "题目已截止，未提交；可核对答案后手动补答" }
            }
            // Match the desktop /retry payload and timestamp rules. Only an explicit manual action selects this route.
            val dt = if (!forceRetry) now else problem.unlockedAt?.plus(2_000)
                ?: problem.deadlineAt?.let { (it - 5_000).coerceAtLeast(0) }
                ?: (now - 2_000).coerceAtLeast(0)
            val entry = JSONObject().put("problemId", problem.id).put("problemType", problem.type.ordinal)
                .put("dt", dt).put("result", result)
            val body = if (forceRetry) JSONObject().put("problems", JSONArray().put(entry)) else entry
            try {
                val response = request(environment, if (forceRetry) "/api/v3/lesson/problem/retry" else "/api/v3/lesson/problem/answer",
                    body = body, lessonId = problem.lessonId)
                if (forceRetry) {
                    val success = JSONObject(response).optJSONObject("data")?.optJSONArray("success")
                    require(success != null && (0 until success.length()).any { success.opt(it)?.toString() == problem.id }) {
                        "雨课堂服务端未确认本题补答成功"
                    }
                }
                problem.answered = true
                return
            } catch (e: ClassroomApiException) {
                // Only retry an explicit token-expired rejection, never a timeout or ambiguous response.
                if (e.code != 50004 || attempt != 0) throw e
                checkin(environment, Lesson(problem.lessonId, "", "active", null, null))
            }
        }
    }

    suspend fun openSocket(environment: Environment, lesson: Lesson, onMessage: (String) -> Unit, onStatus: (Boolean) -> Unit) {
        closeSocket()
        val current = generation
        val session = credentials.load(environment)
        val token = lessonTokens[lesson.id] ?: error("课堂未签到")
        val request = Request.Builder().url(origin(environment).replace("https:", "wss:").replace("http:", "ws:") + "/wsapp/")
            .header("Origin", origin(environment)).apply { if (session.cookieHeader.isNotBlank()) header("Cookie", session.cookieHeader) }.build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (current != generation) { webSocket.close(1000, null); return }
                webSocket.send(JSONObject().put("op", "hello").put("role", "student").put("auth", token)
                    .put("lessonid", lesson.id).apply { session.userId?.let { put("userid", it) } }.toString())
                onStatus(true)
            }
            override fun onMessage(webSocket: WebSocket, text: String) { if (current == generation) onMessage(text) }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { if (current == generation) onStatus(false) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { if (current == generation) onStatus(false) }
        })
    }

    private suspend fun request(environment: Environment, path: String, body: JSONObject? = null, lessonId: String? = null): String = withContext(Dispatchers.IO) {
        val session = credentials.load(environment)
        val request = Request.Builder().url(origin(environment) + path)
            .header("Accept", "application/json").header("xtbz", "ykt").header("x-client", "h5")
            .header("Origin", origin(environment)).header("Referer", origin(environment) + "/")
            .apply {
                if (session.cookieHeader.isNotBlank()) header("Cookie", session.cookieHeader)
                session.bearerToken?.let { header("Authorization", "Bearer $it") }
                lessonId?.let { lessonTokens[it]?.let { token -> header("lesson-token", token) } }
                if (body != null) post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            }.build()
        http.newCall(request).awaitResponse().use { response ->
            response.header("Set-Auth")?.let { credentials.saveBearerToken(environment, it) }
            credentials.captureCookies(environment, response.headers("Set-Cookie"))
            if (response.code == 401 || response.code == 403) {
                credentials.saveBearerToken(environment, null)
                error("登录已失效，请返回网页重新登录后重连课堂")
            }
            if (!response.isSuccessful) error("雨课堂请求失败（HTTP ${response.code}）")
            val text = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { error("服务器未返回课堂数据，请确认已登录所选服务器") }
            if (json.optInt("code", 0) != 0 || json.optBoolean("success", true) == false) throw ClassroomApiException(json.optInt("code"))
            text
        }
    }

    private class ClassroomApiException(val code: Int) : Exception("雨课堂未接受请求（code $code）")

    fun closeSocket() { generation++; socket?.cancel(); socket = null }
    fun close() { closeSocket(); lessonTokens.clear() }
}
