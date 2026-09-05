package com.zaytsev.yuketanghelper.model

enum class Environment(val label: String, val origin: String) {
    STANDARD("雨课堂", "https://www.yuketang.cn"),
    PRO("荷塘雨课堂", "https://pro.yuketang.cn"),
    CHANGJIANG("长江雨课堂", "https://changjiang.yuketang.cn");

    val startUrl: String get() = "$origin/web"
    val webSocketUrl: String get() = origin.replace("https:", "wss:") + "/wsapp/"
}

data class BrowserCredentials(
    val cookieHeader: String,
    val bearerToken: String?,
    val userId: String?,
)

data class Lesson(
    val id: String,
    val title: String,
    val status: String,
    val classroomId: String?,
    val presentationId: String?,
)

enum class ProblemType {
    UNKNOWN,
    SINGLE_CHOICE,
    MULTIPLE_CHOICE,
    POLL,
    FILL_BLANK,
    SUBJECTIVE,
}

data class Problem(
    val id: String,
    val lessonId: String,
    val presentationId: String,
    val slideId: String,
    val type: ProblemType,
    val prompt: String,
    val options: List<String>,
    var unlockedAt: Long? = null,
    var deadlineAt: Long? = null,
    var answered: Boolean = false,
)

data class Slide(
    val id: String,
    val index: Int,
    val title: String,
    val imageUrl: String?,
    val problem: Problem?,
)

data class Presentation(
    val id: String,
    val lessonId: String,
    val title: String,
    val slides: List<Slide>,
)

data class ConnectedLesson(
    val lesson: Lesson,
    val presentation: Presentation?,
    val problems: List<Problem>,
)

data class AiProfile(
    val baseUrl: String,
    val apiKey: String,
    val model: String,
    val visionModel: String = model,
)

data class AiAnswer(
    val answerText: String,
    val explanation: String,
    val rawText: String,
)

data class UserSettings(
    val autoAnalyze: Boolean = true,
    val autoExpandOnProblem: Boolean = true,
    val includeCurrentSlide: Boolean = true,
)
