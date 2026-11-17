package com.zaytsev.yuketanghelper

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.Button
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.zaytsev.yuketanghelper.model.*
import com.zaytsev.yuketanghelper.storage.SettingsStore
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class LogoutTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test fun bottomLogoutClearsAllAccountsAndCachesButKeepsConfiguration() {
        val context = instrumentation.targetContext
        val store = SettingsStore(context)
        val profile = AiProviderPresets.find("deepseek").profile().copy(apiKey = "fake-logout-ai-key")
        store.saveAiProfile(profile)
        val settings = UserSettings(autoAnalyze = true, autoSubmit = false, keepScreenOn = true)
        store.saveSettings(settings)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            try {
                // Seed the three real origins with synthetic credentials only; no real login.
                Environment.entries.forEach { environment ->
                    loadPage(scenario, environment, """
                        localStorage.setItem('Authorization', 'fake-${environment.name}');
                        localStorage.setItem('logout-cache', 'old-account');
                        sessionStorage.setItem('logout-session', 'old-account');
                    """.trimIndent())
                    scenario.onActivity {
                        CookieManager.getInstance().setCookie(environment.origin, "logout_test=${environment.name}; Path=/; Secure; HttpOnly")
                        store.saveBearerToken(environment.name, "fake-${environment.name}")
                    }
                }
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    val problem = Problem("logout-problem", "logout-lesson", "p", "s", ProblemType.SINGLE_CHOICE, "cached account question", listOf("a", "b"))
                    val lesson = Lesson("logout-lesson", "cached account classroom", "active", null, null)
                    session.state.lessons = listOf(lesson)
                    session.state.connected = ConnectedLesson(lesson, null, listOf(problem))
                    session.state.selectedProblem = problem
                    session.state.active = true
                    session.state.online = true
                    session.state.question(problem).draft = "A"
                    session.state.courseAnswers["general"] = "old account answer"
                    session.state.chatDraft = "old account prompt"
                    session.state.events.add("old account event")
                    context.getSharedPreferences("submission_ledger", Context.MODE_PRIVATE).edit().putString("old", "pending").commit()
                    context.getSharedPreferences("problem_alert_history", Context.MODE_PRIVATE).edit().putString("seen", "[\"old\"]").commit()
                    activity.findViewById<View>(R.id.tabSettings).performClick()
                    val buttons = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<Button>()
                    assertEquals("退出登录", buttons.last().text.toString())
                    buttons.last().performClick()
                }
                onView(withId(android.R.id.button2)).inRoot(isDialog()).perform(click())
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    assertTrue(session.state.active)
                    Environment.entries.forEach { assertNotNull(store.bearerToken(it.name)) }
                    descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<Button>().last().performClick()
                }
                onView(withId(android.R.id.button1)).inRoot(isDialog()).perform(click())
                await {
                    var finished = false
                    scenario.onActivity { activity ->
                        val session = (activity.application as HelperApplication).session
                        finished = !session.state.loggingOut && activity.findViewById<WebView>(R.id.webView)?.parent != null &&
                            session.state.status.startsWith("已退出全部")
                    }
                    finished
                }
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    assertFalse(session.state.active)
                    assertFalse(session.state.online)
                    assertFalse(session.state.busy)
                    assertNull(session.state.connected)
                    assertNull(session.state.selectedProblem)
                    assertTrue(session.state.lessons.isEmpty())
                    assertTrue(session.state.questions.isEmpty())
                    assertTrue(session.state.courseAnswers.isEmpty())
                    assertEquals("", session.state.chatDraft)
                    assertFalse(session.state.events.any { it.contains("old account") })
                    assertFalse(activity.findViewById<WebView>(R.id.webView).canGoBack())
                    assertTrue(context.getSharedPreferences("submission_ledger", Context.MODE_PRIVATE).all.isEmpty())
                    assertTrue(context.getSharedPreferences("problem_alert_history", Context.MODE_PRIVATE).all.isEmpty())
                    assertEquals(profile, store.aiProfile())
                    assertEquals(settings, store.settings())
                    Environment.entries.forEach { environment ->
                        assertNull(SettingsStore(context).bearerToken(environment.name))
                        assertFalse(CookieManager.getInstance().getCookie(environment.origin).orEmpty().contains("logout_test="))
                    }
                }
                // New WebView must have neither persistent localStorage nor sessionStorage.
                Environment.entries.forEach { environment ->
                    loadPage(scenario, environment, "")
                    assertEquals("true", evaluate(scenario, "localStorage.getItem('Authorization') === null && localStorage.getItem('logout-cache') === null && sessionStorage.getItem('logout-session') === null"))
                }
                scenario.recreate()
                scenario.onActivity {
                    Environment.entries.forEach { assertNull(SettingsStore(context).bearerToken(it.name)) }
                    assertEquals(profile, SettingsStore(context).aiProfile())
                    assertEquals(settings, SettingsStore(context).settings())
                }
            } finally {
                scenario.onActivity { activity -> (activity.application as HelperApplication).session.disconnect() }
                store.clearAiProfile()
                store.saveSettings(UserSettings())
            }
        }
    }

    private fun loadPage(scenario: ActivityScenario<MainActivity>, environment: Environment, script: String) {
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.webView).apply {
                stopLoading()
                loadDataWithBaseURL(environment.origin + "/", "<html><body><script>$script;window.logoutTestReady='${environment.name}';</script></body></html>", "text/html", "UTF-8", null)
            }
        }
        await { evaluate(scenario, "window.logoutTestReady === '${environment.name}'") == "true" }
    }

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String? {
        val completed = CountDownLatch(1)
        var result: String? = null
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.webView).evaluateJavascript(script) { result = it; completed.countDown() }
        }
        assertTrue("JavaScript callback timed out", completed.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun await(condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < until) {
            if (condition()) return
            Thread.sleep(50)
        }
        fail("Logout/page did not complete")
    }

    private fun descendants(view: View): List<View> = listOf(view) +
        if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
}
