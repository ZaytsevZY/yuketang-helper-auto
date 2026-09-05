package com.zaytsev.yuketanghelper.ui

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.zaytsev.yuketanghelper.model.AiProfile
import com.zaytsev.yuketanghelper.model.Problem
import com.zaytsev.yuketanghelper.storage.SettingsStore

class AssistantController(
    private val context: Context,
    private val container: FrameLayout,
    private val state: AppState,
    private val settingsStore: SettingsStore,
    private val actions: Actions,
    private val onPageShown: (Page) -> Unit = {},
) {
    enum class Page { CLASSROOM, PROBLEMS, AI, COURSEWARE, MODELS, SETTINGS }

    interface Actions {
        fun refreshLessons()
        fun connectLesson(index: Int)
        fun selectProblem(index: Int)
        fun analyzeProblem()
        fun submitAnswer(value: String)
        fun askCourseware(question: String)
        fun changeSlide(delta: Int)
        fun saveAndTestProfile(profile: AiProfile)
    }

    var page: Page = Page.CLASSROOM
        private set

    fun show(page: Page = this.page) {
        this.page = page
        onPageShown(page)
        container.removeAllViews()
        container.addView(
            when (page) {
                Page.CLASSROOM -> classroomPage()
                Page.PROBLEMS -> problemsPage()
                Page.AI -> aiPage()
                Page.COURSEWARE -> coursewarePage()
                Page.MODELS -> modelsPage()
                Page.SETTINGS -> settingsPage()
            },
        )
    }

    private fun classroomPage(): View = page("课堂") {
        status()
        primaryButton(if (state.busy) "正在刷新…" else "刷新课堂", enabled = !state.busy) {
            actions.refreshLessons()
        }
        if (state.lessons.isEmpty()) {
            hint("登录雨课堂后点击刷新。当前仅显示正在上课或即将开始的课堂。")
        } else {
            state.lessons.forEachIndexed { index, lesson ->
                sectionButton(
                    title = lesson.title.ifBlank { "课堂 ${lesson.id}" },
                    detail = "${lesson.status} · ${lesson.id}",
                    selected = state.connected?.lesson?.id == lesson.id,
                ) { actions.connectLesson(index) }
            }
        }
    }

    private fun problemsPage(): View = page("题目") {
        val problems = state.connected?.problems.orEmpty()
        if (problems.isEmpty()) {
            hint("尚未同步到题目。请先在“课堂”页连接课堂。")
            return@page
        }
        val spinner = Spinner(context)
        spinner.adapter = ArrayAdapter(
            context,
            android.R.layout.simple_spinner_dropdown_item,
            problems.mapIndexed { index, problem ->
                "${index + 1}. ${problem.prompt.ifBlank { "题目 ${problem.id}" }.take(42)}"
            },
        )
        val selected = problems.indexOfFirst { it.id == state.selectedProblem?.id }.coerceAtLeast(0)
        spinner.setSelection(selected)
        addView(spinner, matchWrap())
        secondaryButton("查看所选题目") { actions.selectProblem(spinner.selectedItemPosition) }
        problemCard(state.selectedProblem ?: problems[selected])
        secondaryButton("AI 分析") {
            actions.selectProblem(spinner.selectedItemPosition)
            actions.analyzeProblem()
        }
        val answerInput = input("输入或修改答案，例如 A / A,B", state.aiAnswer?.answerText.orEmpty())
        primaryButton("校验并提交") {
            val value = answerInput.editText?.text?.toString().orEmpty()
            if (value.isBlank()) return@primaryButton
            AlertDialog.Builder(context)
                .setTitle("确认提交答案？")
                .setMessage("答案：$value\n\n提交后可能无法撤销，请确认你已核对题目与答案。")
                .setNegativeButton("取消", null)
                .setPositiveButton("确认提交") { _, _ -> actions.submitAnswer(value) }
                .show()
        }
    }

    private fun aiPage(): View = page("AI 答题") {
        val problem = state.selectedProblem
        if (problem == null) {
            hint("先在“课堂”页连接课堂并选择题目。")
            return@page
        }
        problemCard(problem)
        primaryButton(if (state.busy) "分析中…" else "自动分析题目", enabled = !state.busy) {
            actions.analyzeProblem()
        }
        val answer = state.aiAnswer
        if (answer == null) {
            hint("模型只生成可核对的建议，不会绕过确认直接提交。")
        } else {
            label("建议答案", bold = true)
            selectable(answer.answerText.ifBlank { "未解析出答案" })
            label("解释", bold = true)
            selectable(answer.explanation.ifBlank { answer.rawText })
            secondaryButton("带入题目页核对") { show(Page.PROBLEMS) }
        }
    }

    private fun coursewarePage(): View = page("课件问答") {
        val presentation = state.connected?.presentation
        if (presentation == null || presentation.slides.isEmpty()) {
            hint("当前课堂没有可用课件。")
            return@page
        }
        val slide = presentation.slides[state.slideIndex.coerceIn(presentation.slides.indices)]
        label("${presentation.title.ifBlank { "课件" }} · 第 ${slide.index + 1}/${presentation.slides.size} 页", bold = true)
        slide.imageUrl?.let { url ->
            val image = ImageView(context).apply {
                adjustViewBounds = true
                minimumHeight = dp(160)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                setBackgroundColor(Color.rgb(238, 243, 240))
                loadRemoteImage(this, url)
            }
            addView(image, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(240)))
        } ?: hint("本页没有图片。")
        horizontal {
            smallButton("上一页") { actions.changeSlide(-1) }
            smallButton("下一页") { actions.changeSlide(1) }
        }
        val question = input("询问当前课件页", "")
        primaryButton("询问课件") {
            actions.askCourseware(question.editText?.text?.toString().orEmpty())
        }
        state.aiAnswer?.takeIf { it.answerText.isBlank() }?.let {
            label("回答", bold = true)
            selectable(it.rawText)
        }
    }

    private fun modelsPage(): View = page("模型") {
        val existing = settingsStore.aiProfile()
        val baseUrl = input("Base URL", existing?.baseUrl ?: "https://api.openai.com/v1")
        val apiKey = input("API Key", "", secret = true)
        val model = input("文本模型", existing?.model.orEmpty())
        val vision = input("视觉模型", existing?.visionModel.orEmpty())
        hint(if (existing == null) "API Key 会使用 Android Keystore 加密保存。" else "已保存 API Key；留空表示继续使用原 Key。")
        primaryButton("保存并测试连接") {
            val currentKey = apiKey.editText?.text?.toString().orEmpty().ifBlank { existing?.apiKey.orEmpty() }
            actions.saveAndTestProfile(
                AiProfile(
                    baseUrl = baseUrl.editText?.text?.toString().orEmpty(),
                    apiKey = currentKey,
                    model = model.editText?.text?.toString().orEmpty(),
                    visionModel = vision.editText?.text?.toString().orEmpty()
                        .ifBlank { model.editText?.text?.toString().orEmpty() },
                ),
            )
        }
    }

    private fun settingsPage(): View = page("设置") {
        val value = settingsStore.settings()
        val autoAnalyze = checkbox("检测到新题目后自动调用模型", value.autoAnalyze)
        val autoExpand = checkbox("检测到新题目后展开助手", value.autoExpandOnProblem)
        val includeSlide = checkbox("答题和询问时附带当前课件页", value.includeCurrentSlide)
        hint("不会开启网络抓包、深度捕获或后台无提示自动提交。")
        primaryButton("保存设置") {
            settingsStore.saveSettings(
                com.zaytsev.yuketanghelper.model.UserSettings(
                    autoAnalyze = autoAnalyze.isChecked,
                    autoExpandOnProblem = autoExpand.isChecked,
                    includeCurrentSlide = includeSlide.isChecked,
                ),
            )
            show(Page.SETTINGS)
        }
    }

    private fun LinearLayout.problemCard(problem: Problem) {
        label(problem.prompt.ifBlank { "题干主要位于课件图片中" }, bold = true)
        problem.options.forEachIndexed { index, option -> label("${'A' + index}. $option") }
        hint("题型：${problem.type} · ${if (problem.unlockedAt == null) "未解锁" else "可作答"}")
    }

    private fun page(title: String, content: LinearLayout.() -> Unit): View {
        val body = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(32))
            label(title, bold = true, size = 22f)
            content()
        }
        return ScrollView(context).apply {
            isFillViewport = true
            addView(body)
        }
    }

    private fun LinearLayout.status() = hint(state.status)

    private fun LinearLayout.label(text: String, bold: Boolean = false, size: Float = 15f): TextView =
        TextView(context).also { view ->
            view.text = text
            view.textSize = size
            view.setTextColor(Color.rgb(23, 35, 29))
            view.setPadding(0, dp(8), 0, dp(5))
            if (bold) view.setTypeface(view.typeface, android.graphics.Typeface.BOLD)
            addView(view, matchWrap())
        }

    private fun LinearLayout.hint(text: String): TextView = label(text, size = 13f).apply {
        setTextColor(Color.rgb(88, 103, 95))
    }

    private fun LinearLayout.selectable(text: String): TextView = label(text).apply {
        setTextIsSelectable(true)
        setPadding(dp(12), dp(10), dp(12), dp(10))
        setBackgroundColor(Color.rgb(232, 240, 235))
    }

    private fun LinearLayout.input(label: String, value: String, secret: Boolean = false): TextInputLayout {
        val edit = TextInputEditText(context).apply {
            setText(value)
            if (secret) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        return TextInputLayout(context).also { layout ->
            layout.hint = label
            layout.setPadding(0, dp(6), 0, dp(4))
            layout.addView(edit)
            addView(layout, matchWrap())
        }
    }

    private fun LinearLayout.checkbox(text: String, checked: Boolean): CheckBox = CheckBox(context).also {
        it.text = text
        it.isChecked = checked
        addView(it, matchWrap())
    }

    private fun LinearLayout.primaryButton(text: String, enabled: Boolean = true, click: () -> Unit) {
        addView(MaterialButton(context).apply {
            this.text = text
            isEnabled = enabled
            setOnClickListener { click() }
        }, matchWrap())
    }

    private fun LinearLayout.secondaryButton(text: String, click: () -> Unit) {
        addView(MaterialButton(context, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            this.text = text
            setOnClickListener { click() }
        }, matchWrap())
    }

    private fun LinearLayout.sectionButton(title: String, detail: String, selected: Boolean, click: () -> Unit) {
        addView(MaterialButton(context, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = (if (selected) "✓ " else "") + title + "\n" + detail
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            isAllCaps = false
            setOnClickListener { click() }
        }, matchWrap())
    }

    private fun LinearLayout.horizontal(content: LinearLayout.() -> Unit) {
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            content()
        }, matchWrap())
    }

    private fun LinearLayout.smallButton(text: String, click: () -> Unit) {
        addView(Button(context).apply {
            this.text = text
            setOnClickListener { click() }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun loadRemoteImage(view: ImageView, url: String) {
        Thread {
            val bitmap = runCatching {
                java.net.URL(url).openStream().use(android.graphics.BitmapFactory::decodeStream)
            }.getOrNull()
            view.post { if (bitmap != null) view.setImageBitmap(bitmap) }
        }.start()
    }

    private fun matchWrap() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { setMargins(0, dp(3), 0, dp(3)) }

    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
}
