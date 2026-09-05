package com.zaytsev.yuketanghelper.ui

import com.zaytsev.yuketanghelper.model.AiAnswer
import com.zaytsev.yuketanghelper.model.ConnectedLesson
import com.zaytsev.yuketanghelper.model.Environment
import com.zaytsev.yuketanghelper.model.Lesson
import com.zaytsev.yuketanghelper.model.Problem

data class AppState(
    var environment: Environment = Environment.STANDARD,
    var lessons: List<Lesson> = emptyList(),
    var connected: ConnectedLesson? = null,
    var selectedProblem: Problem? = null,
    var slideIndex: Int = 0,
    var aiAnswer: AiAnswer? = null,
    var busy: Boolean = false,
    var status: String = "请先在网页中登录雨课堂",
)
