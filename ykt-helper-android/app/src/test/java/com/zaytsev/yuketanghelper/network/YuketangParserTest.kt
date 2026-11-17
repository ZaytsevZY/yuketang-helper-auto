package com.zaytsev.yuketanghelper.network

import com.zaytsev.yuketanghelper.model.ProblemType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.json.JSONObject
import org.junit.Test

class YuketangParserTest {
    @Test
    fun parsesLessonsAndPresentationFromDev3Shape() {
        val lessons = YuketangParser.lessons(
            """{"data":{"onLessonClassrooms":[{"lessonId":"l1","lessonName":"高数","status":1,"classroomId":"c1","presentationId":"p1"}]}}""",
        )
        assertEquals("高数", lessons.single().title)
        assertEquals("p1", lessons.single().presentationId)

        val presentation = YuketangParser.presentation(
            """{"data":{"id":"p1","title":"第一章","slides":[{"id":"s1","imageUrl":"https://img.yuketang.cn/1.png","problem":{"problemId":"q1","problemType":1,"content":"1+1=?","options":["1","2"]}}]}}""",
            "l1",
            "p1",
        )
        val problem = presentation.slides.single().problem
        assertNotNull(problem)
        assertEquals(ProblemType.SINGLE_CHOICE, problem?.type)
        assertEquals(listOf("1", "2"), problem?.options)
    }

    @Test
    fun parsesUnlockEvent() {
        val event = YuketangParser.unlockProblem(
            """{"op":"unlockproblem","problem":{"problemId":"q1","dt":1700000000,"limit":30}}""",
        )
        assertEquals("q1", event?.first)
        assertEquals(1_700_000_000_000L, event?.second)
        assertEquals(1_700_000_030_000L, event?.third)
    }

    @Test fun preservesSubmittedChoiceBlankAndSubjectiveAnswers() {
        fun parse(type: Int, result: String) = YuketangParser.presentation(
            """{"data":{"id":"p","slides":[{"id":"s","index":6,"problem":{"id":"q","type":$type,"result":$result}}]}}""", "l", "p")
            .slides.single().problem!!
        val choice = parse(2, """["A","C"]""")
        assertTrue(choice.answered)
        assertEquals(listOf("A", "C"), choice.submittedAnswer!!.values)
        assertEquals(listOf("one", "", "three"), parse(4, """["one","","three"]""").submittedAnswer!!.values)
        val subjective = parse(5, """{"content":"line 1\nline 2","pics":[{"pic":""},{"pic":"https://example.com/a.png"}],"videos":[{"url":"https://example.com/v.mp4"}]}""")
        assertEquals(listOf("line 1\nline 2"), subjective.submittedAnswer!!.values)
        assertEquals(1, subjective.submittedAnswer!!.pictureCount)
        assertEquals(1, subjective.submittedAnswer!!.videoCount)
        for (empty in listOf("null", "[]", """{"content":"","pics":[{"pic":""}],"videos":[]}""")) {
            val p = parse(5, empty)
            assertFalse(p.answered)
            assertNull(p.submittedAnswer)
        }
        assertNotNull(parse(5, """{"content":"","pics":["https://example.com/a.png"]}""").submittedAnswer)
        assertNull(YuketangParser.submittedAnswer(JSONObject.NULL))
    }
}
