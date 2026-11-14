package com.zaytsev.yuketanghelper.ui

import com.zaytsev.yuketanghelper.model.*

enum class ModelStatusKind { IDLE, TESTING, SUCCESS, ERROR }

data class QuestionState(
    var answer: AiAnswer? = null,
    var draft: String = "",
    var analyzing: Boolean = false,
    var submitting: Boolean = false,
    var submissionUnknown: Boolean = false,
    var status: String = "等待作答",
)

data class AppState(
    var environment: Environment = Environment.STANDARD,
    var lessons: List<Lesson> = emptyList(),
    var connected: ConnectedLesson? = null,
    var selectedProblem: Problem? = null,
    var slideIndex: Int = 0,
    var busy: Boolean = false,
    var active: Boolean = false,
    var online: Boolean = false,
    var status: String = "请先在网页中登录雨课堂",
    var chatBusy: Boolean = false,
    var chatDraft: String = "",
    val courseAnswers: MutableMap<String, String> = mutableMapOf(),
    var modelStatusKind: ModelStatusKind = ModelStatusKind.IDLE,
    var modelStatus: String = "填写模型配置后，可发送实际请求测试连接",
    val questions: MutableMap<String, QuestionState> = linkedMapOf(),
    val events: MutableList<String> = mutableListOf(),
) {
    fun question(problem: Problem): QuestionState = questions.getOrPut(problem.id) { QuestionState() }
    val aiAnswer: AiAnswer? get() = selectedProblem?.let { questions[it.id]?.answer }
}
