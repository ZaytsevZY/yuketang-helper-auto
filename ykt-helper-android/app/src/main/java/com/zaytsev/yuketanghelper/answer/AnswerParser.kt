package com.zaytsev.yuketanghelper.answer

import com.zaytsev.yuketanghelper.model.AiAnswer
import com.zaytsev.yuketanghelper.model.Problem
import com.zaytsev.yuketanghelper.model.ProblemType
import org.json.JSONArray
import org.json.JSONObject

object AnswerParser {
    fun aiResponse(rawText: String): AiAnswer {
        val text = rawText.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        val json = runCatching { JSONObject(text) }.getOrNull()
        if (json != null) {
            val answer = when (val value = json.opt("answer")) {
                is JSONArray -> (0 until value.length()).joinToString("\n") { value.optString(it) }
                is String -> value
                else -> ""
            }
            return AiAnswer(answer, json.optString("explanation"), rawText)
        }
        // A missing answer marker must not turn arbitrary prose into a submission.
        val answer = Regex("(?:^|\\n)\\s*答案\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*解释\\s*[:：]|$)")
            .find(text)?.groupValues?.get(1)?.trim().orEmpty()
        val explanation = Regex("解释\\s*[:：]\\s*([\\s\\S]+)").find(text)?.groupValues?.get(1)?.trim().orEmpty()
        return AiAnswer(answer, explanation, rawText)
    }

    fun normalized(problem: Problem, input: String): List<String>? {
        val value = input.trim()
        if (value.isEmpty()) return null
        return when (problem.type) {
            ProblemType.SINGLE_CHOICE, ProblemType.POLL, ProblemType.MULTIPLE_CHOICE -> {
                val letters = value.uppercase(java.util.Locale.ROOT)
                if (!Regex("[A-Z](?:[A-Z,，、\\s]*[A-Z])?").matches(letters)) return null
                val answers = letters.filter { it in 'A'..'Z' }.map(Char::toString).distinct().sorted()
                if (problem.type != ProblemType.MULTIPLE_CHOICE && answers.size != 1) return null
                if (problem.options.isEmpty() || answers.any { it[0] - 'A' >= problem.options.size }) return null
                answers
            }
            ProblemType.FILL_BLANK -> value.lines().map(String::trim).takeIf {
                it.none(String::isBlank) && (problem.blankCount == 0 || it.size == problem.blankCount)
            }
            ProblemType.SUBJECTIVE -> listOf(value)
            ProblemType.UNKNOWN -> null
        }
    }
}
