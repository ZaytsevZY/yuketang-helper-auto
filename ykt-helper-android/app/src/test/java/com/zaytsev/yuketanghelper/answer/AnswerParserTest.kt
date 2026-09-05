package com.zaytsev.yuketanghelper.answer

import com.zaytsev.yuketanghelper.model.Problem
import com.zaytsev.yuketanghelper.model.ProblemType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AnswerParserTest {
    private fun problem(type: ProblemType) = Problem(
        id = "1",
        lessonId = "lesson",
        presentationId = "presentation",
        slideId = "slide",
        type = type,
        prompt = "测试题",
        options = listOf("一", "二", "三"),
        unlockedAt = 1L,
    )

    @Test
    fun parsesStructuredAiAnswer() {
        val result = AnswerParser.aiResponse("答案: B\n解释: 因为课件第二项正确")
        assertEquals("B", result.answerText)
        assertEquals("因为课件第二项正确", result.explanation)
    }

    @Test
    fun normalizesChoiceAnswers() {
        assertEquals(listOf("A", "C"), AnswerParser.normalized(problem(ProblemType.MULTIPLE_CHOICE), "C, A"))
        assertEquals(listOf("B"), AnswerParser.normalized(problem(ProblemType.SINGLE_CHOICE), "B"))
        assertNull(AnswerParser.normalized(problem(ProblemType.SINGLE_CHOICE), "AB"))
    }
}
