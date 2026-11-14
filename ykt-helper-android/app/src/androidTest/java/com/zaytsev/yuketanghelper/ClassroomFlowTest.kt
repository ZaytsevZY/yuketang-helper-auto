package com.zaytsev.yuketanghelper

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zaytsev.yuketanghelper.model.*
import com.zaytsev.yuketanghelper.network.*
import com.zaytsev.yuketanghelper.session.ClassroomSession
import com.zaytsev.yuketanghelper.web.CredentialSource
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.mockwebserver.*
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class ClassroomFlowTest {
    private lateinit var server: MockWebServer
    private lateinit var session: ClassroomSession
    private val submissions = CopyOnWriteArrayList<String>()
    private val retries = CopyOnWriteArrayList<String>()
    @Volatile private var acknowledgeRetry = true
    private val completions = CopyOnWriteArrayList<String>()
    @Volatile private var socket: WebSocket? = null
    @Volatile private var aiDelay = 0L
    @Volatile private var answer = "B"
    @Volatile private var rejectSubmit = false
    private val lesson = Lesson("12345", "模拟物理课堂", "active", "c1", "p1")

    @Before fun setup() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("submission_ledger", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("problem_alert_history", Context.MODE_PRIVATE).edit().clear().commit()
        server = MockWebServer()
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path == "/api/v3/lesson/checkin" -> json("""{"code":0,"data":{"lessonToken":"test-lesson-token"}}""")
                request.path?.startsWith("/api/v3/lesson/presentation/fetch") == true -> json(deck)
                request.path == "/wsapp/" -> MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) { socket = webSocket }
                })
                request.path == "/v1/chat/completions" -> {
                    completions.add(request.body.readUtf8())
                    json(JSONObject().put("choices", org.json.JSONArray().put(JSONObject().put("message", JSONObject().put("content",
                        JSONObject().put("answer", org.json.JSONArray().put(answer)).put("explanation", "模拟依据").toString())))).toString())
                        .setBodyDelay(aiDelay, TimeUnit.MILLISECONDS)
                }
                request.path == "/api/v3/lesson/problem/retry" -> {
                    val body = request.body.readUtf8()
                    retries.add(body)
                    val id = JSONObject(body).getJSONArray("problems").getJSONObject(0).getString("problemId")
                    json(JSONObject().put("code", 0).put("data", JSONObject().put("success", org.json.JSONArray().apply {
                        if (acknowledgeRetry) put(id)
                    })).toString())
                }
                request.path == "/api/v3/lesson/problem/answer" -> {
                    submissions.add(request.body.readUtf8())
                    if (rejectSubmit) MockResponse().setResponseCode(500) else json("""{"code":0}""")
                }
                else -> MockResponse().setResponseCode(404)
            }
        }
        server.start()
        val credentials = object : CredentialSource {
            override suspend fun load(environment: Environment) = BrowserCredentials("test=session", "test", "u1")
            override fun saveBearerToken(environment: Environment, token: String?) = Unit
        }
        val client = YuketangClient(credentials, origin = { server.url("/").toString().trimEnd('/') })
        val aiHttp = OkHttpClient.Builder().addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().url(server.url("/v1/chat/completions")).build())
        }.build()
        withContext(Dispatchers.Main) {
            session = ClassroomSession(context, client, AiClient(aiHttp), 100)
            session.settings.saveAiProfile(AiProfile("https://test.invalid/v1", "fake-test-key", "mock-model"))
            session.saveSettings(UserSettings(autoAnalyze = true, includeCurrentSlide = false, autoSubmit = true))
            session.connect(lesson)
        }
        waitUntil { session.state.online && session.state.connected?.problems?.size == 2 }
    }
    @After fun teardown() = runBlocking {
        withContext(Dispatchers.Main) {
            session.disconnect(); session.scope.cancel()
            session.settings.clearAiProfile(); session.settings.saveSettings(UserSettings())
        }
        server.shutdown()
    }

    @Test fun liveUnlockAlertsEvenBeforeQuestionMetadataArrives() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        grantNotificationPermission(context)
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        withContext(Dispatchers.Main) { session.saveSettings(UserSettings(autoAnalyze = false, autoSubmit = false)) }
        socket!!.send("""{"op":"unlockproblem","prob":"not-in-deck","dt":${System.currentTimeMillis()},"limit":0}""")
        waitUntil { manager.activeNotifications.any { it.id == 20 } }
        assertEquals("未定时限", manager.activeNotifications.first { it.id == 20 }.notification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString())
        assertTrue(session.state.connected!!.problems.none { it.id == "not-in-deck" })
    }
    @Test fun historicalTimelineDoesNotAlertButNextLiveQuestionDoes() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        grantNotificationPermission(context)
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        withContext(Dispatchers.Main) { session.saveSettings(UserSettings(autoAnalyze = false, autoSubmit = false)) }
        socket!!.send("""{"op":"fetchtimeline","timeline":[{"type":"problem","prob":"q1","dt":${System.currentTimeMillis() - 60000},"limit":0}]}""")
        waitUntil { session.state.connected!!.problems.first { it.id == "q1" }.unlockedAt != null }
        assertTrue(manager.activeNotifications.none { it.id == 20 })
        send("q2")
        waitUntil { manager.activeNotifications.any { it.id == 20 } }
        assertEquals(1, manager.activeNotifications.count { it.id == 20 })
    }
    @Test fun socketQuestionPostsSystemAlertWithoutActivityAndSettingsDisableIt() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        grantNotificationPermission(context)
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        withContext(Dispatchers.Main) { session.saveSettings(UserSettings(autoAnalyze = false, autoSubmit = false)) }
        send("q1")
        waitUntil { manager.activeNotifications.any { it.id == 20 } }
        val notification = manager.activeNotifications.first { it.id == 20 }
        assertEquals("模拟物理课堂发布了一个问题", notification.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString())
        assertEquals("时限 60 秒", notification.notification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString())
        send("q1")
        delay(300)
        assertEquals(notification.postTime, manager.activeNotifications.first { it.id == 20 }.postTime)
        withContext(Dispatchers.Main) { session.saveSettings(session.settings.settings().copy(notifyNewProblems = false)) }
        send("q2")
        waitUntil { session.state.connected!!.problems.all { it.unlockedAt != null } }
        waitUntil { manager.activeNotifications.none { it.id == 20 } }
        assertTrue(completions.isEmpty())
    }
    @Test fun twoNewQuestionsAreAnsweredWhileAiIsBusyAndDuplicatePushesAreIgnored() = runBlocking {
        aiDelay = 250
        send("q1"); send("q2"); send("q1")
        waitUntil { submissions.size == 2 }
        delay(500)
        assertEquals(setOf("q1", "q2"), submissions.map { JSONObject(it).getString("problemId") }.toSet())
        assertEquals(2, submissions.size)
        assertEquals(2, completions.size)
        withContext(Dispatchers.Main) { assertTrue(session.state.connected!!.problems.all { it.answered }) }
    }
    @Test fun matchingQuestionImageFlowsThroughVisionDraftAndAutomaticSubmission() = runBlocking {
        withContext(Dispatchers.Main) {
            session.settings.saveAiProfile(AiProfile("https://test.invalid/v1", "fake-test-key", "mock-text", "mock-vision"))
            session.saveSettings(session.settings.settings().copy(includeCurrentSlide = true))
            // Viewing another slide must not change the image attached to the question.
            session.state.slideIndex = 1
        }
        send("q1")
        waitUntil { submissions.size == 1 && session.state.questions["q1"]?.analyzing == false }
        val request = JSONObject(completions.single())
        assertEquals("mock-vision", request.getString("model"))
        val parts = request.getJSONArray("messages").getJSONObject(0).getJSONArray("content")
        assertEquals("https://example.com/question-1.png", parts.getJSONObject(1).getJSONObject("image_url").getString("url"))
        assertEquals("B", JSONObject(submissions.single()).getJSONArray("result").getString(0))
        withContext(Dispatchers.Main) {
            assertEquals("B", session.state.questions["q1"]!!.draft)
            assertEquals("已提交", session.state.questions["q1"]!!.status)
            assertTrue(session.state.connected!!.problems.first { it.id == "q1" }.answered)
        }
    }
    @Test fun expiredQuestionCanBeManuallyRetriedAndConfirmedAnswerCanBeCorrected() = runBlocking {
        socket!!.send("""{"op":"unlockproblem","prob":"q1","dt":${System.currentTimeMillis() - 60_000},"limit":1}""")
        waitUntil { session.state.connected!!.problems.first().deadlineAt != null }
        withContext(Dispatchers.Main) { session.submit(session.state.connected!!.problems.first(), "A", forceRetry = true) }
        waitUntil { session.state.questions["q1"]?.status == "补答成功" }
        assertTrue(completions.isEmpty())
        assertTrue(submissions.isEmpty())
        withContext(Dispatchers.Main) {
            assertTrue(session.state.connected!!.problems.first().answered)
            session.submit(session.state.connected!!.problems.first(), "B", forceRetry = true)
        }
        waitUntil { retries.size == 2 && session.state.questions["q1"]?.submitting == false }
        assertEquals(listOf("A", "B"), retries.map { JSONObject(it).getJSONArray("problems").getJSONObject(0).getJSONArray("result").getString(0) })
    }
    @Test fun unconfirmedRetryIsBlockedAfterRejoiningUntilManualVerification() = runBlocking {
        acknowledgeRetry = false
        withContext(Dispatchers.Main) { session.submit(session.state.connected!!.problems.first(), "B", forceRetry = true) }
        waitUntil { retries.size == 1 && session.state.questions["q1"]?.submitting == false }
        withContext(Dispatchers.Main) { session.connect(lesson) }
        waitUntil { !session.state.busy && session.state.online }
        withContext(Dispatchers.Main) {
            val p = session.state.connected!!.problems.first()
            assertTrue(session.state.question(p).submissionUnknown)
            assertFalse(p.answered)
            session.submit(p, "B", forceRetry = true)
        }
        delay(200)
        assertEquals(1, retries.size)
        acknowledgeRetry = true
        withContext(Dispatchers.Main) {
            val p = session.state.connected!!.problems.first()
            session.allowManualRetry(p)
            session.submit(p, "B", forceRetry = true)
        }
        waitUntil { session.state.questions["q1"]?.status == "补答成功" }
        assertEquals(2, retries.size)
    }
    @Test fun pauseStopsPendingAutomaticSubmission() = runBlocking {
        aiDelay = 500
        send("q1")
        waitUntil { completions.isNotEmpty() }
        withContext(Dispatchers.Main) { session.saveSettings(session.settings.settings().copy(autoSubmit = false)) }
        waitUntil { session.state.questions["q1"]?.analyzing == false }
        assertEquals(0, submissions.size)
    }
    @Test fun invalidModelAnswerIsNotSubmitted() = runBlocking {
        answer = "Z"
        send("q1")
        waitUntil { session.state.questions["q1"]?.analyzing == false }
        assertEquals(0, submissions.size)
        withContext(Dispatchers.Main) { assertTrue(session.state.questions["q1"]!!.status.contains("格式")) }
    }
    @Test fun switchingServerCancelsInFlightAnswer() = runBlocking {
        aiDelay = 500
        send("q1")
        waitUntil { completions.isNotEmpty() }
        withContext(Dispatchers.Main) { session.switchEnvironment(Environment.PRO) }
        delay(800)
        assertEquals(0, submissions.size)
        withContext(Dispatchers.Main) { assertNull(session.state.connected); assertFalse(session.state.active) }
    }
    @Test fun uncertainSubmissionIsNotRetriedAfterRejoining() = runBlocking {
        rejectSubmit = true
        send("q1")
        waitUntil { submissions.size == 1 && session.state.questions["q1"]?.submitting == false }
        withContext(Dispatchers.Main) { session.connect(lesson) }
        waitUntil { !session.state.busy && session.state.online }
        send("q1")
        delay(500)
        assertEquals(1, submissions.size)
        withContext(Dispatchers.Main) { assertTrue(session.state.questions["q1"]!!.submissionUnknown) }
    }
    @Test fun lateBrowserPresentationBindsPendingUnlockAndRejectsWrongLesson() = runBlocking {
        val now = System.currentTimeMillis()
        socket!!.send("""{"op":"unlockproblem","prob":"q3","dt":$now,"limit":60}""")
        withContext(Dispatchers.Main) {
            session.observeBrowser(JSONObject().put("kind", "presentation").put("lessonId", "other").put("id", "p2").put("data", JSONObject(extraDeck)))
        }
        delay(100)
        assertEquals(0, completions.size)
        withContext(Dispatchers.Main) {
            session.observeBrowser(JSONObject().put("kind", "presentation").put("lessonId", lesson.id).put("id", "p2").put("data", JSONObject(extraDeck)))
        }
        waitUntil { submissions.size == 1 }
        assertEquals("q3", JSONObject(submissions.single()).getString("problemId"))
    }
    @Test fun disconnectedSocketReconnectsAndContinuesReceivingQuestions() = runBlocking {
        val previous = socket!!
        previous.close(1000, "simulate network change")
        waitUntil { socket !== previous && session.state.online }
        send("q2")
        waitUntil { submissions.size == 1 }
        assertEquals("q2", JSONObject(submissions.single()).getString("problemId"))
    }
    @Test fun answerThatArrivesAfterDeadlineIsNeverSubmitted() = runBlocking {
        aiDelay = 1400
        socket!!.send("""{"op":"unlockproblem","prob":"q1","pres":"p1","dt":${System.currentTimeMillis()},"limit":1}""")
        waitUntil { completions.isNotEmpty() }
        waitUntil { session.state.questions["q1"]?.analyzing == false }
        assertEquals(0, submissions.size)
    }
    @Test fun delayedSlideAnswerStaysWithOriginalSlide() = runBlocking {
        aiDelay = 250
        withContext(Dispatchers.Main) {
            session.state.slideIndex = 0
            session.ask("解释第一页", true)
            session.state.slideIndex = 1
        }
        waitUntil { !session.state.chatBusy }
        withContext(Dispatchers.Main) {
            assertNotNull(session.state.courseAnswers["slide:s1"])
            assertNull(session.state.courseAnswers["slide:s2"])
            assertNull(session.state.courseAnswers["general"])
        }
    }
    private fun send(id: String) { socket!!.send("""{"op":"unlockproblem","prob":"$id","pres":"p1","dt":${System.currentTimeMillis()},"limit":60}""") }
    private suspend fun waitUntil(predicate: () -> Boolean) = withTimeout(12000) {
        while (!withContext(Dispatchers.Main) { predicate() }) delay(25)
    }
    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)
    companion object {
        val deck = """{"data":{"id":"p1","title":"模拟课件","slides":[{"id":"s1","imageUrl":"https://example.com/question-1.png","problem":{"id":"q1","type":1,"content":"1+1=?","options":["1","2","3"]}},{"id":"s2","imageUrl":"https://example.com/question-2.png","problem":{"id":"q2","type":1,"content":"2+2=?","options":["3","4","5"]}}]}}"""
        val extraDeck = """{"data":{"id":"p2","slides":[{"id":"s3","problem":{"id":"q3","type":1,"content":"3+3=?","options":["5","6","7"]}}]}}"""
    }
}
