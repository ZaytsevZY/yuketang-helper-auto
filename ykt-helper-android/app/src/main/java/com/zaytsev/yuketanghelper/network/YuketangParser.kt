package com.zaytsev.yuketanghelper.network

import com.zaytsev.yuketanghelper.model.Lesson
import com.zaytsev.yuketanghelper.model.Presentation
import com.zaytsev.yuketanghelper.model.Problem
import com.zaytsev.yuketanghelper.model.ProblemType
import com.zaytsev.yuketanghelper.model.Slide
import org.json.JSONArray
import org.json.JSONObject

object YuketangParser {
    fun lessons(json: String): List<Lesson> {
        val root = JSONObject(json)
        val payload = root.value("data") ?: root.value("result") ?: root
        val array = when (payload) {
            is JSONArray -> payload
            is JSONObject -> payload.array("onLessonClassrooms")
                ?: payload.array("on_lesson_classrooms")
                ?: JSONArray()
            else -> JSONArray()
        }
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.id("lessonId", "lesson_id", "id") ?: continue
                add(
                    Lesson(
                        id = id,
                        title = item.text("title", "lessonName", "lesson_name", "name"),
                        status = if (item.optInt("status") == 1) "active" else "upcoming",
                        classroomId = item.id("classroomId", "classroom_id"),
                        presentationId = item.id("presentationId", "presentation_id"),
                    ),
                )
            }
        }
    }

    fun lessonToken(json: String): String {
        val data = unwrap(JSONObject(json))
        return data.id("lessonToken", "lesson_token")
            ?: error("签到响应中没有 lessonToken")
    }

    fun presentation(json: String, lessonId: String, fallbackId: String): Presentation {
        val data = unwrap(JSONObject(json))
        val presentationId = data.id("id", "presentationId", "presentation_id") ?: fallbackId
        val pages = data.array("slides") ?: data.array("pages") ?: JSONArray()
        val slides = buildList {
            for (index in 0 until pages.length()) {
                val item = pages.optJSONObject(index) ?: JSONObject()
                val slideId = item.id("id", "slideId", "slide_id") ?: "$presentationId-$index"
                add(
                    Slide(
                        id = slideId,
                        index = item.optInt("index", item.optInt("pageIndex", index)),
                        title = item.text("title"),
                        imageUrl = item.nullableText("imageUrl", "image_url", "cover"),
                        problem = item.optJSONObject("problem")?.let {
                            problem(it, lessonId, presentationId, slideId)
                        },
                    ),
                )
            }
        }
        return Presentation(
            id = presentationId,
            lessonId = lessonId,
            title = data.text("title", "name"),
            slides = slides,
        )
    }

    fun unlockProblem(json: String): Triple<String, Long, Long?>? {
        val root = JSONObject(json)
        if (root.optString("op") != "unlockproblem") return null
        val problem = root.optJSONObject("problem") ?: return null
        val id = problem.id("problemId", "problem_id", "id") ?: return null
        val unlockedAt = normalizeTimestamp(problem.value("dt") ?: problem.value("unlockedAt"))
            ?: System.currentTimeMillis()
        val limitSeconds = problem.optLong("limit", 0L)
        return Triple(id, unlockedAt, if (limitSeconds > 0) unlockedAt + limitSeconds * 1_000 else null)
    }

    private fun problem(
        data: JSONObject,
        lessonId: String,
        presentationId: String,
        slideId: String,
    ): Problem? {
        val id = data.id("problemId", "problem_id", "id") ?: return null
        val rawOptions = data.array("options") ?: data.array("answers") ?: JSONArray()
        val options = buildList {
            for (index in 0 until rawOptions.length()) {
                val value = rawOptions.opt(index)
                add(
                    if (value is JSONObject) value.text("content", "text", "value")
                    else value?.toString().orEmpty(),
                )
            }
        }
        val numericType = data.value("problemType") ?: data.value("problem_type") ?: data.value("type")
        val type = when (numericType?.toString()?.toIntOrNull()) {
            1 -> ProblemType.SINGLE_CHOICE
            2 -> ProblemType.MULTIPLE_CHOICE
            3 -> ProblemType.POLL
            4 -> ProblemType.FILL_BLANK
            5 -> ProblemType.SUBJECTIVE
            else -> ProblemType.UNKNOWN
        }
        return Problem(
            id = id,
            lessonId = lessonId,
            presentationId = presentationId,
            slideId = slideId,
            type = type,
            prompt = data.text("prompt", "content", "body"),
            options = options,
            answered = data.value("result") != null,
        )
    }

    private fun unwrap(root: JSONObject): JSONObject =
        root.optJSONObject("data") ?: root.optJSONObject("result") ?: root

    private fun JSONObject.value(key: String): Any? = if (has(key) && !isNull(key)) opt(key) else null

    private fun JSONObject.array(key: String): JSONArray? = value(key) as? JSONArray

    private fun JSONObject.id(vararg keys: String): String? = keys.firstNotNullOfOrNull { key ->
        value(key)?.toString()?.takeIf { it.isNotBlank() }
    }

    private fun JSONObject.text(vararg keys: String): String =
        keys.firstNotNullOfOrNull { key -> value(key)?.toString() }.orEmpty()

    private fun JSONObject.nullableText(vararg keys: String): String? =
        keys.firstNotNullOfOrNull { key -> value(key)?.toString()?.takeIf(String::isNotBlank) }

    private fun normalizeTimestamp(value: Any?): Long? {
        val number = value?.toString()?.toDoubleOrNull() ?: return null
        return if (number < 10_000_000_000) (number * 1_000).toLong() else number.toLong()
    }
}
