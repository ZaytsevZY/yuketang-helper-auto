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
                        title = item.text("title", "lessonName", "lesson_name", "classroomName", "classroom_name", "courseName", "course_name", "name"),
                        status = "active",
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
                        imageUrl = item.nullableText("imageUrl", "image_url", "coverAlt", "cover", "image", "thumbnail", "cover_url", "coverUrl", "src"),
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

    data class Unlock(val id: String, val at: Long, val deadline: Long?, val presentationId: String?)

    fun unlockEvents(json: String, now: Long = System.currentTimeMillis()): List<Unlock> {
        val root = JSONObject(json)
        val pieces = if (root.optString("op") == "fetchtimeline") {
            val timeline = root.optJSONArray("timeline") ?: JSONArray()
            (0 until timeline.length()).mapNotNull { timeline.optJSONObject(it) }.filter { it.optString("type") == "problem" }
        } else if (root.optString("op") == "unlockproblem") listOf(root) else emptyList()
        return pieces.mapNotNull { outer ->
            val data = outer.optJSONObject("problem") ?: outer
            val id = data.id("problemId", "problem_id", "problemid", "prob", "id")
                ?: outer.value("problem")?.takeIf { it is String || it is Number }?.toString()
                ?: return@mapNotNull null
            val at = normalizeTimestamp(data.value("dt") ?: outer.value("dt") ?: data.value("unlockedAt")) ?: now
            val limit = data.optLong("limit", outer.optLong("limit", 0)).coerceIn(0, 86400)
            Unlock(id, at, if (limit > 0) at + limit * 1000 else null,
                data.id("pres", "presentationId", "presentation_id") ?: outer.id("pres", "presentationId", "presentation_id"))
        }
    }

    fun unlockProblem(json: String): Triple<String, Long, Long?>? = unlockEvents(json).firstOrNull()?.let {
        Triple(it.id, it.at, it.deadline)
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
            answered = when (val result = data.value("result")) {
                is JSONArray -> result.length() > 0
                is JSONObject -> result.optString("content").isNotBlank() || (result.optJSONArray("pics")?.length() ?: 0) > 0
                else -> false
            },
            blankCount = data.optJSONArray("blanks")?.length() ?: 0,
            encrypted = Regex("[\uE000-\uF8FF]").containsMatchIn(data.text("prompt", "content", "body") + options.joinToString()) ||
                data.optBoolean("encrypted", false) || data.toString().contains("xuetangx-com-encrypted-font"),
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
