package com.zaytsev.yuketanghelper.answer

import com.zaytsev.yuketanghelper.model.AiAnswer
import com.zaytsev.yuketanghelper.model.Problem
import com.zaytsev.yuketanghelper.model.ProblemType

object AnswerParser {
    fun aiResponse(rawText: String): AiAnswer {
        val answer = Regex("答案\\s*[:：]\\s*([^\\n]+)", RegexOption.IGNORE_CASE)
            .find(rawText)?.groupValues?.getOrNull(1)?.trim()
            ?: rawText.lineSequence().firstOrNull().orEmpty().trim()
        val explanation = Regex("解释\\s*[:：]\\s*([\\s\\S]+)", RegexOption.IGNORE_CASE)
            .find(rawText)?.groupValues?.getOrNull(1)?.trim().orEmpty()
        return AiAnswer(answer, explanation, rawText)
    }

    fun normalized(problem: Problem, input: String): List<String>? = when (problem.type) {
        ProblemType.SINGLE_CHOICE, ProblemType.POLL -> choiceValues(input).takeIf { it.size == 1 }
        ProblemType.MULTIPLE_CHOICE -> choiceValues(input).takeIf { it.isNotEmpty() }
        ProblemType.FILL_BLANK -> input.lines().map(String::trim).filter(String::isNotBlank).takeIf { it.isNotEmpty() }
        ProblemType.SUBJECTIVE -> listOf(input.trim()).takeIf { it.firstOrNull()?.isNotBlank() == true }
        ProblemType.UNKNOWN -> null
    }

    private fun choiceValues(input: String): List<String> = input.uppercase()
        .replace(Regex("[^A-Z,，\\s]"), "")
        .split(Regex("[,，\\s]*"))
        .flatMap { value -> if (value.length > 1) value.map(Char::toString) else listOf(value) }
        .filter(String::isNotBlank)
        .distinct()
        .sorted()
}
