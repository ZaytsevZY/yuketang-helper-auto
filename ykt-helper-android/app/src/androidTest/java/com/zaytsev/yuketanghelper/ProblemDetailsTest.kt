package com.zaytsev.yuketanghelper

import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.zaytsev.yuketanghelper.model.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class ProblemDetailsTest {
    @Test fun showsActualSlideStatusAndConfirmedAnswerWithoutReplacingDraft() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            try {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    val first = Problem("details-q1", "details-l", "deck-one", "details-s1", ProblemType.MULTIPLE_CHOICE,
                        "请选择本节课介绍的学习方法。", listOf("课前预习", "只看答案", "课后复习"), answered = true,
                        submittedAnswer = SubmittedAnswer(listOf("A", "C")))
                    val second = Problem("details-q2", "details-l", "deck-two", "details-s2", ProblemType.FILL_BLANK,
                        "请填写本节课的关键词。", emptyList())
                    val deck = Presentation("deck-two", "details-l", "示意课件", listOf(
                        Slide(first.slideId, 6, "", null, first), Slide(second.slideId, 11, "", null, second)))
                    session.state.connected = ConnectedLesson(Lesson("details-l", "示意课堂", "active", null, null), deck, listOf(first, second))
                    session.state.selectedProblem = first
                    session.state.question(first).draft = "B"
                    session.state.question(first).answer = AiAnswer("B", "未提交的 AI 建议", "")
                    activity.findViewById<View>(R.id.tabProblems).performClick()
                    val body = activity.findViewById<ViewGroup>(R.id.assistantContent)
                    assertEquals("课件第 7 页 · 已发布 · 已作答", body.findViewWithTag<TextView>("problemSummary").text.toString())
                    assertEquals("A. 课前预习\nC. 课后复习", body.findViewWithTag<TextView>("submittedAnswerContent").text.toString())
                    assertEquals("已同步作答记录", body.findViewWithTag<TextView>("problemActionStatus").text.toString())
                    assertEquals("B", descendants(body).filterIsInstance<EditText>().single().text.toString())
                }
                val instrumentation = InstrumentationRegistry.getInstrumentation()
                instrumentation.waitForIdleSync()
                val drawn = CountDownLatch(1)
                scenario.onActivity { activity ->
                    val root = activity.window.decorView
                    if (android.os.Build.VERSION.SDK_INT >= 29) {
                        root.viewTreeObserver.registerFrameCommitCallback { drawn.countDown() }
                        root.invalidate()
                    } else root.postDelayed({ drawn.countDown() }, 300)
                }
                assertTrue("Question preview frame should draw", drawn.await(5, TimeUnit.SECONDS))
                instrumentation.uiAutomation.takeScreenshot()?.let { image ->
                    File(instrumentation.targetContext.filesDir, "problem-details-preview.png").outputStream().use {
                        image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
                    }
                    image.recycle()
                }
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    val body = activity.findViewById<ViewGroup>(R.id.assistantContent)
                    val editor = descendants(body).filterIsInstance<EditText>().single()
                    editor.requestFocus(); editor.setText("draft preserved")
                    session.state.selectedProblem!!.apply {
                        submittedAnswer = SubmittedAnswer(listOf("B"))
                        deadlineAt = System.currentTimeMillis() + 150
                    }
                    session.changed()
                    assertEquals("B. 只看答案", body.findViewWithTag<TextView>("submittedAnswerContent").text.toString())
                    assertSame(editor, descendants(body).filterIsInstance<EditText>().single())
                }
                val until = System.currentTimeMillis() + 5000
                var expired = false
                while (!expired && System.currentTimeMillis() < until) {
                    Thread.sleep(50)
                    scenario.onActivity { activity ->
                        val body = activity.findViewById<ViewGroup>(R.id.assistantContent)
                        expired = body.findViewWithTag<TextView>("problemSummary").text.contains("已截止")
                        assertEquals("draft preserved", descendants(body).filterIsInstance<EditText>().single().text.toString())
                    }
                }
                assertTrue("Deadline label should update while editing", expired)
                scenario.onActivity { activity ->
                    activity.findViewById<View>(R.id.assistantContent).clearFocus()
                    activity.selectProblem(1)
                    val session = (activity.application as HelperApplication).session
                    val body = activity.findViewById<ViewGroup>(R.id.assistantContent)
                    assertEquals("课件第 12 页 · 未发布 · 未作答", body.findViewWithTag<TextView>("problemSummary").text.toString())
                    assertEquals(View.GONE, body.findViewWithTag<TextView>("submittedAnswerContent").visibility)
                    val second = session.state.selectedProblem!!
                    second.unlockedAt = System.currentTimeMillis()
                    session.changed()
                    assertEquals("课件第 12 页 · 已发布 · 未作答", body.findViewWithTag<TextView>("problemSummary").text.toString())
                    second.answered = true
                    session.changed()
                    assertTrue(body.findViewWithTag<TextView>("submittedAnswerContent").text.contains("暂未获取到答案内容"))
                    second.submittedAnswer = SubmittedAnswer(listOf("空间", "推理"))
                    session.changed()
                    assertEquals("第 1 空：空间\n第 2 空：推理", body.findViewWithTag<TextView>("submittedAnswerContent").text.toString())
                }
            } finally {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    session.disconnect(); session.state.connected = null; session.state.selectedProblem = null; session.state.questions.clear()
                }
            }
        }
    }

    private fun descendants(view: View): List<View> = listOf(view) +
        if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
}
