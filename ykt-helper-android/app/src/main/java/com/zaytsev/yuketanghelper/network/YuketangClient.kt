package com.zaytsev.yuketanghelper.network

import android.os.Handler
import android.os.Looper
import com.zaytsev.yuketanghelper.answer.AnswerParser
import com.zaytsev.yuketanghelper.model.ConnectedLesson
import com.zaytsev.yuketanghelper.model.Environment
import com.zaytsev.yuketanghelper.model.Lesson
import com.zaytsev.yuketanghelper.model.Presentation
import com.zaytsev.yuketanghelper.model.Problem
import com.zaytsev.yuketanghelper.model.ProblemType
import com.zaytsev.yuketanghelper.web.WebSessionCredentials
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class YuketangClient(
    private val credentials: WebSessionCredentials,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build(),
) {
    private val lessonTokens = mutableMapOf<String, String>()
    private var socket: WebSocket? = null
    private val socketGeneration = AtomicLong()
    private val reconnectHandler = Handler(Looper.getMainLooper())

    suspend fun listLessons(environment: Environment): List<Lesson> = withContext(Dispatchers.IO) {
        YuketangParser.lessons(request(environment, "/api/v3/classroom/on-lesson"))
    }

    suspend fun connectLesson(
        environment: Environment,
        lesson: Lesson,
        onProblem: (Problem) -> Unit,
    ): ConnectedLesson = withContext(Dispatchers.IO) {
        val checkinBody = JSONObject().put("lessonId", lesson.id).apply {
            lesson.classroomId?.let { put("classroomId", it) }
        }
        val token = YuketangParser.lessonToken(
            request(environment, "/api/v3/lesson/checkin", "POST", checkinBody.toString()),
        )
        lessonTokens[lesson.id] = token
        val presentation = lesson.presentationId?.let {
            fetchPresentation(environment, lesson.id, it)
        }
        val connected = ConnectedLesson(
            lesson = lesson,
            presentation = presentation,
            problems = presentation?.slides?.mapNotNull { it.problem }.orEmpty(),
        )
        val userId = credentials.load(environment).userId
        openSocket(environment, connected, token, userId, onProblem, socketGeneration.incrementAndGet())
        connected
    }

    suspend fun submitAnswer(environment: Environment, problem: Problem, input: String) = withContext(Dispatchers.IO) {
        val normalized = AnswerParser.normalized(problem, input)
            ?: error("答案格式与题型不匹配")
        if (!problem.unlockedAt.let { it != null }) error("题目尚未解锁")
        if (problem.answered) error("题目已经作答")
        val result: Any = if (problem.type == ProblemType.SUBJECTIVE) {
            JSONObject().put("content", normalized.first()).put("pics", JSONArray())
        } else {
            JSONArray(normalized)
        }
        val payload = JSONObject()
            .put("problemId", problem.id)
            .put("problemType", legacyType(problem.type))
            .put("dt", System.currentTimeMillis())
            .put("result", result)
        request(
            environment,
            "/api/v3/lesson/problem/answer",
            "POST",
            payload.toString(),
            problem.lessonId,
        )
        problem.answered = true
    }

    fun close() {
        socketGeneration.incrementAndGet()
        socket?.close(1000, "activity stopped")
        socket = null
    }

    private suspend fun fetchPresentation(
        environment: Environment,
        lessonId: String,
        presentationId: String,
    ): Presentation {
        val encoded = java.net.URLEncoder.encode(presentationId, Charsets.UTF_8.name())
        val json = request(
            environment,
            "/api/v3/lesson/presentation/fetch?presentation_id=$encoded",
            lessonId = lessonId,
        )
        return YuketangParser.presentation(json, lessonId, presentationId)
    }

    private suspend fun request(
        environment: Environment,
        path: String,
        method: String = "GET",
        body: String? = null,
        lessonId: String? = null,
    ): String {
        val session = credentials.load(environment)
        val headers = Headers.Builder()
            .add("accept", "application/json")
            .add("content-type", "application/json")
            .add("xtbz", "ykt")
            .add("x-client", "h5")
            .add("origin", environment.origin)
            .add("referer", "${environment.origin}/")
            .apply {
                if (session.cookieHeader.isNotBlank()) add("cookie", session.cookieHeader)
                session.bearerToken?.let { add("authorization", "Bearer $it") }
                lessonId?.let { id -> lessonTokens[id]?.let { add("lesson-token", it) } }
            }
            .build()
        val request = Request.Builder()
            .url(environment.origin + path)
            .headers(headers)
            .method(method, body?.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        return http.newCall(request).execute().use { response ->
            captureAuth(environment, response)
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) error("雨课堂请求失败：HTTP ${response.code}")
            val code = runCatching { JSONObject(text).optInt("code", 0) }.getOrDefault(0)
            if (code != 0) error("雨课堂请求失败：code $code")
            text
        }
    }

    private fun captureAuth(environment: Environment, response: Response) {
        response.header("Set-Auth")?.let { credentials.saveBearerToken(environment, it) }
        if (response.code == 401 || response.code == 403) {
            credentials.saveBearerToken(environment, null)
        }
    }

    private fun openSocket(
        environment: Environment,
        connected: ConnectedLesson,
        token: String,
        userId: String?,
        onProblem: (Problem) -> Unit,
        generation: Long,
    ) {
        socket?.close(1000, "switch lesson")
        val sessionRequest = Request.Builder().url(environment.webSocketUrl).build()
        socket = http.newWebSocket(sessionRequest, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val hello = JSONObject()
                    .put("op", "hello")
                    .put("role", "student")
                    .put("auth", token)
                    .put("lessonid", connected.lesson.id)
                    .put("userid", userId.orEmpty())
                webSocket.send(hello.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val unlocked = runCatching { YuketangParser.unlockProblem(text) }.getOrNull() ?: return
                val problem = connected.problems.firstOrNull { it.id == unlocked.first } ?: return
                problem.unlockedAt = unlocked.second
                problem.deadlineAt = unlocked.third
                onProblem(problem)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (socketGeneration.get() != generation) return
                reconnectHandler.postDelayed({
                    if (socketGeneration.get() == generation) {
                        openSocket(environment, connected, token, userId, onProblem, generation)
                    }
                }, 3_000)
            }
        })
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        private fun legacyType(type: ProblemType): Int = when (type) {
            ProblemType.SINGLE_CHOICE -> 1
            ProblemType.MULTIPLE_CHOICE -> 2
            ProblemType.POLL -> 3
            ProblemType.FILL_BLANK -> 4
            ProblemType.SUBJECTIVE -> 5
            ProblemType.UNKNOWN -> error("未知题型不能提交")
        }
    }
}
