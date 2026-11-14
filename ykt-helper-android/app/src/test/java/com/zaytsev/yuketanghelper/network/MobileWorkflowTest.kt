package com.zaytsev.yuketanghelper.network

import com.zaytsev.yuketanghelper.answer.AnswerParser
import com.zaytsev.yuketanghelper.model.*
import com.zaytsev.yuketanghelper.web.CredentialSource
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class MobileWorkflowTest {
    private fun problem(type: ProblemType = ProblemType.SINGLE_CHOICE) = Problem("q1", "l1", "p1", "s1", type, "1+1=?", listOf("1", "2", "3"), unlockedAt = 1)
    private val credentials = object : CredentialSource {
        override suspend fun load(environment: Environment) = BrowserCredentials("session=test", "test-token", "u1")
        override fun saveBearerToken(environment: Environment, token: String?) = Unit
    }

    @Test fun rejectsOutOfRangeAmbiguousAndUnknownAnswers() {
        assertNull(AnswerParser.normalized(problem(), "Z"))
        assertNull(AnswerParser.normalized(problem(), "I think B"))
        assertNull(AnswerParser.normalized(problem(), "可能是B"))
        assertNull(AnswerParser.normalized(problem(ProblemType.UNKNOWN), "B"))
        assertNull(AnswerParser.normalized(problem().copy(options = emptyList()), "B"))
        assertEquals(listOf("A", "C"), AnswerParser.normalized(problem(ProblemType.MULTIPLE_CHOICE), "c，a"))
    }
    @Test fun parsesJsonAndMultilineWithoutGuessingAnAnswer() {
        val answer = AnswerParser.aiResponse("```json\n{\"answer\":[\"第一空\",\"第二空\"],\"explanation\":\"依据\"}\n```")
        assertEquals("第一空\n第二空", answer.answerText)
        assertEquals("", AnswerParser.aiResponse("我不知道这道题的答案").answerText)
        assertEquals("一\n二", AnswerParser.aiResponse("答案：一\n二\n解释：依据").answerText)
        assertNull(AnswerParser.normalized(problem(ProblemType.FILL_BLANK).copy(blankCount = 2), "仅一空"))
    }
    @Test fun supportsActualTimelineShapeAndMillisecondDeadlines() {
        val events = YuketangParser.unlockEvents("""{"op":"fetchtimeline","timeline":[{"type":"slide","id":"s1"},{"type":"problem","prob":"q1","pres":"p1","dt":1700000000000,"limit":20}]}""")
        assertEquals(1, events.size)
        assertEquals("p1", events.single().presentationId)
        assertEquals(1700000020000, events.single().deadline)
        assertEquals("q2", YuketangParser.unlockEvents("""{"op":"unlockproblem","problem":"q2","pres":"p2","dt":1700000000}""").single().id)
    }
    @Test fun acceptsCurrentLessonNamesImageAliasesAndEmptyResults() {
        val lessons = YuketangParser.lessons("""{"data":{"onLessonClassrooms":[{"lessonId":"9007199254740999","classroomName":"物理"}]}}""")
        assertEquals("active", lessons.single().status)
        assertEquals("物理", lessons.single().title)
        assertEquals("9007199254740999", lessons.single().id)
        val p = YuketangParser.presentation("""{"data":{"slides":[{"id":"s1","coverAlt":"https://example.com/slide","problem":{"id":"q1","type":1,"result":[],"options":["1","2"]}}]}}""", "l1", "p1")
        assertEquals("https://example.com/slide", p.slides.single().imageUrl)
        assertFalse(p.slides.single().problem!!.answered)
    }
    @Test fun normalizesEndpointsWithoutLeakingCredentialsIntoUrls() {
        assertEquals("https://api.example.com/v1/chat/completions", AiClient.endpoint("https://api.example.com", "chat/completions"))
        assertEquals("https://api.example.com/v1/chat/completions", AiClient.endpoint("https://api.example.com/v1/chat/completions", "chat/completions"))
        for (url in listOf("https://user:secret@example.com", "https://example.com?key=secret", "https://example.com/#x", "https://")) {
            assertThrows(IllegalArgumentException::class.java) { AiClient.endpoint(url, "models") }
        }
    }
    @Test fun modelTestActuallyPostsACompletionAndWorksWithoutModelsEndpoint() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"choices":[{"message":{"content":"连接成功"}}]}"""))
            val http = OkHttpClient.Builder().addInterceptor { chain -> chain.proceed(chain.request().newBuilder().url(server.url(chain.request().url.encodedPath)).build()) }.build()
            val ai = AiClient(http)
            assertEquals("连接成功", ai.test(AiProfile("https://provider.example/v1", "test-key", "text-model")))
            val req = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("POST", req.method)
            assertEquals("/v1/chat/completions", req.path)
            assertEquals("Bearer test-key", req.getHeader("Authorization"))
            assertEquals("text-model", JSONObject(req.body.readUtf8()).getString("model"))
        }
    }
    @Test fun visionAnswerUsesMatchingImageAndVisionModel() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"choices":[{"message":{"content":"{\"answer\":[\"B\"],\"explanation\":\"2\"}"}}]}"""))
            val http = OkHttpClient.Builder().addInterceptor { chain -> chain.proceed(chain.request().newBuilder().url(server.url("/v1/chat/completions")).build()) }.build()
            val answer = AiClient(http).answerProblem(AiProfile("https://provider.example/v1", "key", "text", "vision"), problem(), "https://example.com/s1.png")
            assertEquals("B", answer.answerText)
            val body = JSONObject(server.takeRequest().body.readUtf8())
            assertEquals("vision", body.getString("model"))
            assertEquals("https://example.com/s1.png", body.getJSONArray("messages").getJSONObject(0).getJSONArray("content").getJSONObject(1).getJSONObject("image_url").getString("url"))
        }
    }
    @Test fun apiErrorDoesNotEchoProviderBodyOrKey() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401).setBody("secret-provider-body"))
            val http = OkHttpClient.Builder().addInterceptor { chain -> chain.proceed(chain.request().newBuilder().url(server.url("/")).build()) }.build()
            val error = runCatching { AiClient(http).test(AiProfile("https://example.com", "key", "model")) }.exceptionOrNull()
            assertNotNull(error)
            assertFalse(error!!.message.orEmpty().contains("secret-provider-body"))
        }
    }
    @Test fun checkinFetchAndSubmitUseSessionHeadersAndServerAcknowledgement() = runBlocking {
        MockWebServer().use { server ->
            val client = YuketangClient(credentials, origin = { server.url("/").toString().trimEnd('/') })
            server.enqueue(MockResponse().setBody("""{"code":0,"data":{"lessonToken":"lesson-token"}}"""))
            client.checkin(Environment.STANDARD, Lesson("l1", "课程", "active", "c1", "p1"))
            val checkin = server.takeRequest()
            assertEquals("session=test", checkin.getHeader("Cookie"))
            assertEquals("c1", JSONObject(checkin.body.readUtf8()).getString("classroomId"))
            server.enqueue(MockResponse().setBody("""{"code":0,"data":{"slides":[]}}"""))
            client.fetchPresentation(Environment.STANDARD, "l1", "p1")
            assertEquals("lesson-token", server.takeRequest().getHeader("lesson-token"))
            server.enqueue(MockResponse().setBody("""{"code":0}"""))
            val p = problem()
            client.submitAnswer(Environment.STANDARD, p, "B")
            assertTrue(p.answered)
            val submit = JSONObject(server.takeRequest().body.readUtf8())
            assertEquals("q1", submit.getString("problemId"))
            assertEquals("B", submit.getJSONArray("result").getString(0))
        }
    }
    @Test fun expiredAndAnsweredProblemsNeverReachNetwork() = runBlocking {
        MockWebServer().use { server ->
            val client = YuketangClient(credentials, origin = { server.url("/").toString().trimEnd('/') })
            assertTrue(runCatching { client.submitAnswer(Environment.STANDARD, problem().copy(deadlineAt = 2), "B") }.isFailure)
            assertTrue(runCatching { client.submitAnswer(Environment.STANDARD, problem().copy(answered = true), "B") }.isFailure)
            assertEquals(0, server.requestCount)
        }
    }
    @Test fun explicitRetryUsesDesktopEnvelopeAndAcceptsOnlyMatchingAcknowledgement() = runBlocking {
        MockWebServer().use { server ->
            val client = YuketangClient(credentials, origin = { server.url("/").toString().trimEnd('/') })
            val p = problem().copy(unlockedAt = 10_000, deadlineAt = 20_000, answered = true)
            server.enqueue(MockResponse().setBody("""{"code":0,"data":{"success":["q1"]}}"""))
            client.submitAnswer(Environment.STANDARD, p, "A", forceRetry = true)
            val request = server.takeRequest()
            assertEquals("/api/v3/lesson/problem/retry", request.path)
            val entry = JSONObject(request.body.readUtf8()).getJSONArray("problems").getJSONObject(0)
            assertEquals("q1", entry.getString("problemId"))
            assertEquals(12_000L, entry.getLong("dt"))
            assertEquals(1, entry.getInt("problemType"))
            assertEquals("A", entry.getJSONArray("result").getString(0))
            for (response in listOf("""{"code":0}""", """{"code":0,"data":{"success":[]}}""", """{"code":0,"data":{"success":["other"]}}""")) {
                val unanswered = problem().copy(deadlineAt = 2)
                server.enqueue(MockResponse().setBody(response))
                assertTrue(runCatching { client.submitAnswer(Environment.STANDARD, unanswered, "B", true) }.isFailure)
                assertFalse(unanswered.answered)
                server.takeRequest()
            }
        }
    }
    @Test fun retryTimestampFallbackAndAllSupportedAnswerTypesKeepTheirPayloadShapes() = runBlocking {
        MockWebServer().use { server ->
            val client = YuketangClient(credentials, origin = { server.url("/").toString().trimEnd('/') })
            for ((type, value) in listOf(ProblemType.SINGLE_CHOICE to "B", ProblemType.MULTIPLE_CHOICE to "A,C",
                ProblemType.POLL to "B", ProblemType.FILL_BLANK to "第一空\n第二空", ProblemType.SUBJECTIVE to "完整答案")) {
                server.enqueue(MockResponse().setBody("""{"code":0,"data":{"success":["q1"]}}"""))
                client.submitAnswer(Environment.STANDARD, problem(type).copy(unlockedAt = null, deadlineAt = 10_000), value, true)
                val entry = JSONObject(server.takeRequest().body.readUtf8()).getJSONArray("problems").getJSONObject(0)
                assertEquals(5_000L, entry.getLong("dt"))
                assertEquals(type.ordinal, entry.getInt("problemType"))
                if (type == ProblemType.SUBJECTIVE) assertEquals(value, entry.getJSONObject("result").getString("content"))
                else assertEquals(if (type in listOf(ProblemType.MULTIPLE_CHOICE, ProblemType.FILL_BLANK)) 2 else 1, entry.getJSONArray("result").length())
            }
        }
    }
    @Test fun retryRefreshesExplicitlyExpiredTokenOnceAndKeepsRetryRoute() = runBlocking {
        MockWebServer().use { server ->
            val client = YuketangClient(credentials, origin = { server.url("/").toString().trimEnd('/') })
            server.enqueue(MockResponse().setBody("""{"code":50004}"""))
            server.enqueue(MockResponse().setBody("""{"code":0,"data":{"lessonToken":"refreshed"}}"""))
            server.enqueue(MockResponse().setBody("""{"code":0,"data":{"success":["q1"]}}"""))
            client.submitAnswer(Environment.STANDARD, problem().copy(deadlineAt = 2), "B", true)
            assertEquals("/api/v3/lesson/problem/retry", server.takeRequest().path)
            assertEquals("/api/v3/lesson/checkin", server.takeRequest().path)
            val retry = server.takeRequest()
            assertEquals("/api/v3/lesson/problem/retry", retry.path)
            assertEquals("refreshed", retry.getHeader("lesson-token"))
        }
    }
    @Test fun failedSubmissionDoesNotMarkAnswered() = runBlocking {
        MockWebServer().use { server ->
            val client = YuketangClient(credentials, origin = { server.url("/").toString().trimEnd('/') })
            server.enqueue(MockResponse().setBody("""{"code":4001}"""))
            val p = problem()
            assertTrue(runCatching { client.submitAnswer(Environment.STANDARD, p, "B") }.isFailure)
            assertFalse(p.answered)
        }
    }
    @Test fun cancellationStopsSlowRequests() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{}").setHeadersDelay(2, TimeUnit.SECONDS))
            val job = launch(Dispatchers.IO) { OkHttpClient().newCall(okhttp3.Request.Builder().url(server.url("/")).build()).awaitResponse().close() }
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            job.cancelAndJoin()
            assertTrue(job.isCancelled)
        }
    }
}
