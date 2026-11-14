package com.zaytsev.yuketanghelper

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.view.View
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.material.button.MaterialButton
import com.zaytsev.yuketanghelper.model.*
import com.zaytsev.yuketanghelper.network.YuketangParser
import com.zaytsev.yuketanghelper.session.ProblemNotifications
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

internal fun grantNotificationPermission(context: Context) {
    if (Build.VERSION.SDK_INT >= 33) {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(
            "pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }
}

@RunWith(AndroidJUnit4::class)
class ProblemNotificationsTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()
    private val manager get() = context.getSystemService(NotificationManager::class.java)
    private lateinit var alerts: ProblemNotifications
    private val lesson = Lesson("alert-lesson", "高等数学", "active", null, null)
    private fun problem(id: String, timed: Boolean = true): Problem {
        val now = System.currentTimeMillis()
        return Problem(id, lesson.id, "p", "s", ProblemType.SINGLE_CHOICE, "通知测试题目", listOf("甲", "乙"), now,
            if (timed) now + 60_000 else null)
    }
    private fun ProblemNotifications.show(environment: Environment, lesson: Lesson, p: Problem, enabled: Boolean): Boolean =
        show(environment, lesson, YuketangParser.Unlock(p.id, p.unlockedAt!!, p.deadlineAt, p.presentationId), enabled, p.answered)
    private fun posted() = manager.activeNotifications.filter { it.id == 20 }
    private fun awaitCount(count: Int) {
        val end = System.currentTimeMillis() + 4000
        while (posted().size != count && System.currentTimeMillis() < end) Thread.sleep(25)
        assertEquals(count, posted().size)
    }
    @Before fun setup() {
        grantNotificationPermission(context)
        context.getSharedPreferences("problem_alert_history", Context.MODE_PRIVATE).edit().clear().commit()
        alerts = ProblemNotifications(context)
        alerts.clear()
        awaitCount(0)
    }
    @After fun teardown() { alerts.clear() }

    @Test fun timedAndUntimedNotificationsAreDistinctAndDuplicatesSurviveRecreation() {
        val first = problem("timed")
        assertTrue(alerts.show(Environment.STANDARD, lesson, first, true))
        assertTrue(alerts.show(Environment.STANDARD, lesson, problem("untimed", false), true))
        awaitCount(2)
        val notices = posted().map { it.notification }
        assertTrue(notices.all { it.extras.getCharSequence(Notification.EXTRA_TITLE).toString() == "高等数学课堂发布了一个问题" })
        assertEquals(setOf("时限 60 秒", "未定时限"), notices.map { it.extras.getCharSequence(Notification.EXTRA_TEXT).toString() }.toSet())
        assertNotEquals(notices[0].contentIntent, notices[1].contentIntent)
        if (Build.VERSION.SDK_INT >= 26) assertEquals(NotificationManager.IMPORTANCE_HIGH, manager.getNotificationChannel(ProblemNotifications.CHANNEL).importance)
        assertFalse(ProblemNotifications(context).show(Environment.STANDARD, lesson, first, true))
        alerts.clear(); awaitCount(0)
        assertFalse(ProblemNotifications(context).show(Environment.STANDARD, lesson, first, true))
    }

    @Test fun mutedAnsweredAndExpiredQuestionsDoNotAlertOrReplayWhenEnabled() {
        val muted = problem("muted")
        assertFalse(alerts.show(Environment.STANDARD, lesson, muted, false))
        assertFalse(alerts.show(Environment.STANDARD, lesson, problem("answered").apply { answered = true }, true))
        assertFalse(alerts.show(Environment.STANDARD, lesson, problem("expired").apply { deadlineAt = System.currentTimeMillis() - 1 }, true))
        assertFalse(ProblemNotifications(context).show(Environment.STANDARD, lesson, muted, true))
        awaitCount(0)
    }

    @Test fun notificationClickOpensItsQuestionAndStaleClickDoesNotSwitchClassrooms() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val first = problem("first")
            val target = problem("target")
            try {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    session.state.environment = Environment.STANDARD
                    session.state.connected = ConnectedLesson(lesson, null, listOf(first, target))
                    session.state.active = true
                    session.state.selectedProblem = first
                    activity.findViewById<View>(R.id.settingsButton).performClick()
                    assertTrue(alerts.show(Environment.STANDARD, lesson, target, true))
                }
                awaitCount(1)
                val click = posted().single().notification.contentIntent
                click.send()
                InstrumentationRegistry.getInstrumentation().waitForIdleSync()
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    assertEquals("target", session.state.selectedProblem?.id)
                    assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.assistantSheet).visibility)
                    assertTrue(activity.findViewById<MaterialButton>(R.id.tabProblems).isChecked)
                    session.disconnect()
                }
                click.send()
                InstrumentationRegistry.getInstrumentation().waitForIdleSync()
                scenario.onActivity { activity ->
                    assertTrue(activity.findViewById<MaterialButton>(R.id.tabClassroom).isChecked)
                    assertFalse((activity.application as HelperApplication).session.state.active)
                }
            } finally {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    session.disconnect(); session.state.connected = null; session.state.selectedProblem = null
                }
            }
        }
    }
}
