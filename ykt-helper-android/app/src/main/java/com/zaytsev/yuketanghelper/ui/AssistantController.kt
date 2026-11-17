package com.zaytsev.yuketanghelper.ui

import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.core.widget.NestedScrollView
import androidx.core.widget.doAfterTextChanged
import android.text.Html
import android.os.Build
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.zaytsev.yuketanghelper.model.AiProfile
import com.zaytsev.yuketanghelper.model.AiProviderPresets
import com.zaytsev.yuketanghelper.model.Problem
import com.zaytsev.yuketanghelper.model.UserSettings
import com.zaytsev.yuketanghelper.model.ProblemType
import com.zaytsev.yuketanghelper.storage.SettingsStore

class AssistantController(
    private val context: Context,
    private val container: FrameLayout,
    private val state: AppState,
    private val settingsStore: SettingsStore,
    private val actions: Actions,
    private val onPageShown: (Page) -> Unit = {},
) {
    enum class Page { CLASSROOM, PROBLEMS, AI, COURSEWARE, MODELS, SETTINGS, ABOUT, BACKGROUND }

    interface Actions {
        fun refreshLessons()
        fun connectLesson(index: Int)
        fun selectProblem(index: Int)
        fun analyzeProblem()
        fun submitAnswer(problemId: String, value: String, forceRetry: Boolean = false)
        fun askCourseware(question: String)
        fun changeSlide(delta: Int)
        fun saveAndTestProfile(profile: AiProfile, test: Boolean)
        fun disconnect()
        fun resync()
        fun saveSettings(value: com.zaytsev.yuketanghelper.model.UserSettings)
        fun retrySubmission()
        fun openWebsite()
        fun cancelAi()
        fun exportSlide()
        fun openBackgroundSettings(batteryOptimization: Boolean)
        fun openNotificationSettings()
        fun clearProfile()
        fun logout()
        fun changeEnvironment(environment: com.zaytsev.yuketanghelper.model.Environment)
    }

    private var modelProviderId: String? = null
    private var syncingSettings = false
    private var displayedProblemId: String? = null
    private val deadlineRefresh = Runnable { refresh() }

    fun dispose() { container.removeCallbacks(deadlineRefresh) }

    fun refresh() {
        container.findViewWithTag<TextView>("modelConnectionStatus")?.let(::renderModelStatus)
        if (page == Page.PROBLEMS) {
            refreshProblemSummary()
            scheduleProblemDeadline()
        }
        // Do not destroy a focused editor when another question or socket event arrives.
        if (container.findFocus() is EditText) return
        if (page == Page.SETTINGS && container.findViewWithTag<View>("notifyNewProblems") != null) {
            refreshSettingsPage()
            return
        }
        show()
    }

    var page: Page = Page.CLASSROOM
        private set

    fun show(page: Page = this.page) {
        container.removeCallbacks(deadlineRefresh)
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
                Page.ABOUT -> aboutPage()
                Page.BACKGROUND -> backgroundPage()
            },
        )
        if (page == Page.PROBLEMS) scheduleProblemDeadline()
    }

    private fun classroomPage(): View = page("我的课堂") {
        status()
        if (settingsStore.aiProfile() == null) {
            hint("首次使用：网页登录 → AI 配置 → 刷新并进入课堂。")
            secondaryButton("1 · 打开雨课堂登录") { actions.openWebsite() }
            secondaryButton("2 · 打开 AI 配置") { show(Page.MODELS) }
        }
        primaryButton(if (state.busy) "正在同步…" else "刷新正在上课的课堂", enabled = !state.busy) { actions.refreshLessons() }
        if (state.active) {
            label(state.connected?.lesson?.title.orEmpty().ifBlank { "当前课堂" }, bold = true)
            hint("${if (state.online) "已连接" else "正在重连"} · ${state.connected?.problems?.size ?: 0} 道题目 · ${state.connected?.presentation?.slides?.size ?: 0} 页课件")
            val enabled = settingsStore.settings().autoSubmit
            primaryButton(if (enabled) "暂停自动回答" else "开启自动回答") {
                actions.saveSettings(settingsStore.settings().copy(autoAnalyze = true, autoSubmit = !enabled))
            }
            hint("自动回答：新题目解锁后调用 AI，格式通过校验后等待 3 秒提交。可随时暂停。")
            horizontal {
                smallButton("重新同步") { actions.resync() }
                smallButton("退出课堂") { actions.disconnect() }
            }
        }
        if (state.lessons.isEmpty()) hint("登录后刷新。这里只显示正在进行中的课堂。")
        state.lessons.forEachIndexed { index, lesson ->
            sectionButton(lesson.title.ifBlank { "课堂 ${lesson.id}" }, "正在上课 · 点击进入", state.active && state.connected?.lesson?.id == lesson.id) { actions.connectLesson(index) }
        }
        if (state.events.isNotEmpty()) {
            label("最近状态", bold = true)
            state.events.take(6).forEach { hint(it) }
        }
    }

    private fun problemsPage(): View = page("课堂题目") {
        val problems = state.connected?.problems.orEmpty()
        if (problems.isEmpty()) {
            hint("尚未同步到题目。进入课堂后，教师发布的课件和题目会自动同步。")
            secondaryButton("前往课堂") { show(Page.CLASSROOM) }
            return@page
        }
        val selected = problems.indexOfFirst { it.id == state.selectedProblem?.id }.coerceAtLeast(0)
        val problem = problems[selected]
        displayedProblemId = problem.id
        val q = state.question(problem)
        hint(problemSummary(problem)).apply {
            tag = "problemSummary"
            setTextColor(GlassUi.accent)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            GlassUi.card(this, GlassUi.control, 12f)
        }
        val spinner = Spinner(context, Spinner.MODE_DROPDOWN)
        GlassUi.spinner(spinner, problems.mapIndexed { index, p ->
            "${problemSummary(p)}\n${index + 1}. ${plain(p.prompt).ifBlank { "题目 ${p.id}" }.take(32)}"
        })
        spinner.setSelection(selected)
        addView(spinner, matchWrap())
        secondaryButton("查看所选题目") { actions.selectProblem(spinner.selectedItemPosition) }
        label("已提交的答案", bold = true).apply {
            tag = "submittedAnswerHeading"
            visibility = if (problem.answered) View.VISIBLE else View.GONE
        }
        selectable(submittedAnswerText(problem)).apply {
            tag = "submittedAnswerContent"
            visibility = if (problem.answered) View.VISIBLE else View.GONE
        }
        problemCard(problem)
        hint(problemActionStatus(problem)).tag = "problemActionStatus"
        primaryButton(if (q.analyzing) "AI 正在分析…" else "AI 分析本题", !q.analyzing) { actions.analyzeProblem() }
        q.answer?.let {
            label("AI 建议", bold = true)
            selectable(it.explanation.ifBlank { it.rawText })
        }
        val answerInput = input(if (problem.type == com.zaytsev.yuketanghelper.model.ProblemType.FILL_BLANK) "每行填写一个空" else "答案（选择题填字母，多选可填 A,C）", q.draft)
        answerInput.editText?.doAfterTextChanged { q.draft = it?.toString().orEmpty() }
        val expired = problem.deadlineAt?.let { it <= System.currentTimeMillis() } == true
        val needsRetry = expired || problem.answered
        val canSubmit = state.active && state.online && !q.submitting && !q.submissionUnknown
            && (needsRetry || problem.unlockedAt != null)
        fun confirmSubmission(forceRetry: Boolean) {
            val value = answerInput.editText?.text?.toString().orEmpty()
            val action = if (forceRetry) "补答" else "提交"
            val detail = if (forceRetry) "将通过补答接口提交${if (problem.answered) "并尝试修改已答答案" else ""}，是否接受以雨课堂返回结果为准。\n\n" else ""
            MaterialAlertDialogBuilder(context).setTitle("确认${action}本题？")
                .setMessage("${detail}答案：$value")
                .setNegativeButton("取消", null).setPositiveButton(action) { _, _ -> actions.submitAnswer(problem.id, value, forceRetry) }.showGlass()
        }
        primaryButton(if (q.submitting) q.status else if (problem.answered) "修改答案并补答" else if (expired) "补答本题（已截止）" else "提交答案", canSubmit) {
            confirmSubmission(needsRetry)
        }
        if (!needsRetry) secondaryButton("手动补答（使用补交接口）", canSubmit) { confirmSubmission(true) }
        hint("补答需保持课堂连接并手动确认。自动回答不会补交过期题目，服务端未明确确认时会提示核对结果。")
        if (q.submissionUnknown) {
            hint("上次提交或补答未收到确认。请先打开网页核对；不会自动重复提交。")
            secondaryButton("打开网页核对") { actions.openWebsite() }
            secondaryButton("我已核对网页，允许手动重试") {
                MaterialAlertDialogBuilder(context).setTitle("已核对服务端作答结果？")
                    .setMessage("请确认本次提交或修改未生效。解除后仍需手动确认提交或补答，不会自动重试。")
                    .setNegativeButton("取消", null).setPositiveButton("允许重试") { _, _ -> actions.retrySubmission() }.showGlass()
            }
        }
    }

    private fun aiPage(): View = page("AI 学习问答") {
        hint("可直接提问，也可以在题目页分析课堂题目、在课件页询问当前图片。")
        val question = input("输入你的问题", state.chatDraft)
        question.editText?.doAfterTextChanged { state.chatDraft = it?.toString().orEmpty() }
        primaryButton(if (state.chatBusy) "AI 正在回答…" else "发送问题", !state.chatBusy) {
            actions.askCourseware(question.editText?.text?.toString().orEmpty())
        }
        if (state.chatBusy) secondaryButton("停止生成") { actions.cancelAi() }
        state.courseAnswers["general"]?.let { selectable(it) }
        secondaryButton("打开 AI 配置") { show(Page.MODELS) }
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
                setBackgroundColor(GlassUi.control)
                loadRemoteImage(this, url)
            }
            addView(image, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(240)))
        } ?: hint("本页没有图片。")
        horizontal {
            smallButton("上一页") { actions.changeSlide(-1) }
            smallButton("下一页") { actions.changeSlide(1) }
        }
        val question = input("询问当前课件页", state.chatDraft)
        question.editText?.doAfterTextChanged { state.chatDraft = it?.toString().orEmpty() }
        primaryButton(if (state.chatBusy) "AI 正在回答…" else "询问课件", !state.chatBusy) {
            actions.askCourseware(question.editText?.text?.toString().orEmpty())
        }
        secondaryButton("保存本页图片") { actions.exportSlide() }
        if (state.chatBusy) secondaryButton("停止生成") { actions.cancelAi() }
        state.courseAnswers["slide:${slide.id}"]?.let {
            label("回答", bold = true)
            selectable(it)
        }
    }

    private fun modelsPage(): View = page("AI 配置") {
        if (modelProviderId == null) modelProviderId = settingsStore.selectedAiProviderId()
        val providerId = modelProviderId!!
        val existing = settingsStore.aiDraft(providerId)
        addView(TextView(context).apply {
            tag = "modelConnectionStatus"
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(dp(12), dp(12), dp(12), dp(12))
            compoundDrawablePadding = dp(10)
            renderModelStatus(this)
        }, matchWrap())
        label("选择服务商", bold = true)
        val provider = Spinner(context, Spinner.MODE_DROPDOWN).apply {
            tag = "aiProvider"
            contentDescription = "AI 服务商预设"
            GlassUi.spinner(this, AiProviderPresets.all.map { it.label })
            setSelection(AiProviderPresets.all.indexOfFirst { it.id == providerId })
        }
        addView(provider, matchWrap())
        hint("各服务商的 Key、接口和模型分别自动保存，切换或重启可恢复。填写完成后，点击启用用于 AI 问答和自动回答。")
        val enabledProfile = settingsStore.aiProfile()
        hint(enabledProfile?.let { "当前已启用：${AiProviderPresets.find(it.providerPresetId).label} · ${it.model}" }
            ?: "当前尚未启用 AI 配置")
        val baseUrl = input("Base URL（OpenAI 兼容接口）", existing.baseUrl)
        val apiKey = input("API Key", existing.apiKey, sensitive = true)
        val model = input("文本模型名称", existing.model)
        val vision = input("视觉模型（留空沿用文本模型）", existing.visionModel)
        fun snapshot(): AiProfile = AiProfile(
            baseUrl.editText?.text?.toString().orEmpty().trim(),
            apiKey.editText?.text?.toString().orEmpty().trim(),
            model.editText?.text?.toString().orEmpty().trim(),
            vision.editText?.text?.toString().orEmpty().trim(), providerId)
        listOf(baseUrl, apiKey, model, vision).forEach { field ->
            field.editText?.doAfterTextChanged {
                settingsStore.saveAiDraft(snapshot())
                showDraftSavedStatus()
            }
        }
        provider.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val next = AiProviderPresets.all[position].id
                if (next == modelProviderId) return
                settingsStore.saveAiDraft(snapshot())
                settingsStore.selectAiProvider(next)
                modelProviderId = next
                showDraftSavedStatus()
                show(Page.MODELS)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        hint("API Key 在本机加密保存；测试连接会产生实际模型请求。")
        primaryButton("启用当前配置并测试") { actions.saveAndTestProfile(snapshot(), true) }
        secondaryButton("启用当前配置") { actions.saveAndTestProfile(snapshot(), false) }
        secondaryButton("清除全部服务商配置") {
            MaterialAlertDialogBuilder(context).setTitle("清除全部服务商配置？")
                .setMessage("将删除所有服务商保存的 API Key、接口和模型配置。")
                .setNegativeButton("取消", null).setPositiveButton("清除") { _, _ ->
                    modelProviderId = null
                    actions.clearProfile()
                }.showGlass()
        }
    }

    private fun showDraftSavedStatus() {
        state.modelStatusKind = ModelStatusKind.IDLE
        state.modelStatus = "配置已自动保存；点击启用后用于问答"
        container.findViewWithTag<TextView>("modelConnectionStatus")?.let(::renderModelStatus)
    }

    private fun renderModelStatus(view: TextView) {
        val (foreground, background) = when (state.modelStatusKind) {
            ModelStatusKind.SUCCESS -> Color.rgb(20, 125, 64) to Color.rgb(229, 246, 235)
            ModelStatusKind.ERROR -> Color.rgb(176, 37, 37) to Color.rgb(255, 237, 237)
            ModelStatusKind.TESTING -> Color.rgb(151, 95, 0) to Color.rgb(255, 246, 219)
            ModelStatusKind.IDLE -> GlassUi.secondary to GlassUi.control
        }
        view.text = state.modelStatus
        view.setTextColor(foreground)
        view.background = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(10).toFloat()
            setColor(background)
        }
        val dot = android.graphics.drawable.GradientDrawable().apply {
            shape = android.graphics.drawable.GradientDrawable.OVAL
            setColor(foreground)
            setBounds(0, 0, dp(10), dp(10))
        }
        view.setCompoundDrawablesRelative(dot, null, null, null)
    }

    private fun aboutPage(): View = page("关于") {
        label("版本信息", bold = true)
        label(context.getString(com.zaytsev.yuketanghelper.R.string.app_title_version,
            com.zaytsev.yuketanghelper.BuildConfig.VERSION_NAME)).tag = "appVersionInfo"
        hint("支持 Android 6.0 及以上 · 请保持 Android System WebView 更新")
        label("版权信息", bold = true)
        hint("版权所有，侵权必究。\n开源许可：MIT")
        label("使用提示", bold = true)
        selectable("请按照学校、课堂和老师的相关规定使用本应用，不得用于课堂或考试作弊。")
        secondaryButton("返回设置") { show(Page.SETTINGS) }
    }

    private fun backgroundPage(): View = page("后台运行设置") {
        hint("用于切到其他应用或熄屏后继续接收课堂题目。“屏幕常亮”只控制屏幕，不代表允许后台运行。")
        label("当前系统状态", bold = true)
        selectable(BackgroundRunSupport.status(context)).tag = "backgroundSystemStatus"
        hint("以上为系统可读取的状态；厂商的自启动、后台锁定状态需要在手机设置中核对。返回本页会刷新状态。")
        label("1 · 允许后台运行", bold = true)
        hint("进入本应用的系统详情，找到“电池”或“应用耗电管理”，选择“无限制”或允许后台活动。设置名称随手机系统而不同。")
        primaryButton("打开应用系统设置") { actions.openBackgroundSettings(false) }
        hint("也可进入电池优化列表，切换到“所有应用”，找到“雨课堂助手”，选择“不优化”。部分系统称为“不允许优化”，这里的“不允许”指不允许系统限制应用。")
        secondaryButton("打开电池优化设置") { actions.openBackgroundSettings(true) }
        label("2 · 在多任务中锁定应用", bold = true)
        hint("从屏幕底部上滑并停留，或点击多任务键，找到“雨课堂助手”卡片。按系统提供的菜单选择“锁定”或小锁图标；部分手机需要下拉卡片，部分需要长按卡片。")
        hint("不要把应用卡片向上划走，这通常会结束应用。锁定需要你在多任务界面操作，助手不能自动替你加锁。")
        label("常见手机的设置", bold = true)
        hint("小米 / Redmi：查找“应用智能省电”，将雨课堂助手设为“无限制”；如有后台自启动选项，可按需允许。")
        hint("支持 Android 应用的华为系统：在“应用启动管理”中关闭本应用的自动管理，再允许后台活动；多任务卡片可下拉加锁。")
        hint("其他品牌：在应用详情或系统设置中搜索“允许后台运行”“后台耗电”“自启动”。以本机提供的选项为准。")
        hint("完成设置可减少后台中断，但不保证永久运行。上课期间保持课堂连接；强行停止、系统清理或退出课堂仍会中断收题。")
        secondaryButton("返回设置") { show(Page.SETTINGS) }
    }

    private fun settingsPage(): View = page("设置") {
        secondaryButton("关于") { show(Page.ABOUT) }
        secondaryButton("后台运行设置") { show(Page.BACKGROUND) }
        hint("设置调整后自动保存并立即生效。")
        label("雨课堂服务器", bold = true)
        val environments = com.zaytsev.yuketanghelper.model.Environment.entries
        addView(Spinner(context, Spinner.MODE_DROPDOWN).apply {
            tag = "classroomEnvironment"
            contentDescription = "雨课堂服务器"
            GlassUi.spinner(this, environments.map { it.label })
            setSelection(state.environment.ordinal)
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    if (environments[position] != state.environment) actions.changeEnvironment(environments[position])
                }
                override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            }
        }, matchWrap())
        hint("切换服务器会退出当前课堂，请在登录网页中登录所选服务器。")
        val value = settingsStore.settings()
        settingSwitch("自动提交成功通知", "notifyAutoSubmissions", value.notifyAutoSubmissions) { old, checked -> old.copy(notifyAutoSubmissions = checked) }
        hint("助手自动提交成功后通知“已自动提交一道题，刷新查看”。点击通知会刷新网页并打开对应题目。")
        settingSwitch("新题目弹窗提醒", "notifyNewProblems", value.notifyNewProblems) { old, checked -> old.copy(notifyNewProblems = checked) }
        hint("默认开启。连接课堂期间收到新题目时，通知显示课堂名称和时限；点击通知可查看题目。")
        hint(notificationPermissionHint()).tag = "notificationPermissionHint"
        secondaryButton("系统通知设置") { actions.openNotificationSettings() }
        settingSwitch("新题目自动生成 AI 答案", "autoAnalyze", value.autoAnalyze) { old, checked -> old.copy(autoAnalyze = checked) }
        settingSwitch("自动提交 AI 答案", "autoSubmit", value.autoSubmit) { old, checked -> old.copy(autoSubmit = checked) }
        settingSwitch("收到新题目时显示题目页", "autoExpandOnProblem", value.autoExpandOnProblem) { old, checked -> old.copy(autoExpandOnProblem = checked) }
        settingSwitch("AI 答题附带题目所在课件图片", "includeCurrentSlide", value.includeCurrentSlide) { old, checked -> old.copy(includeCurrentSlide = checked) }
        settingSwitch("上课期间保持屏幕常亮", "keepScreenOn", value.keepScreenOn) { old, checked -> old.copy(keepScreenOn = checked) }
        hint("自动提交仅作用于当前连接课堂中新解锁的题目。关闭后尚未发送的提交会停止，已发出的请求无法撤回。")
        hint("后台上课会显示常驻通知；退出课堂即可停止。系统省电策略或强行结束应用可能中断连接。")
        hint("退出后将清除雨课堂、荷塘雨课堂、长江雨课堂的登录状态及本地课堂、题目和课件缓存。AI 配置和其他设置保留。")
        secondaryButton("退出登录") {
            MaterialAlertDialogBuilder(context).setTitle("退出全部雨课堂账号？")
                .setMessage("将退出雨课堂、荷塘雨课堂、长江雨课堂，停止当前课堂和自动回答，并清除登录信息、网页及课堂缓存。\n\nAI 配置和其他设置保留，继续使用需重新登录。")
                .setNegativeButton("取消", null)
                .setPositiveButton("退出登录") { _, _ -> actions.logout() }.showGlass()
        }
    }

    private fun notificationPermissionHint(): String =
        if (com.zaytsev.yuketanghelper.session.ProblemNotifications(context).bannersAllowed())
            "系统已允许题目提醒；横幅仍受勿扰模式等系统设置影响。"
        else "系统通知或横幅未开启，请在系统通知设置中允许通知及横幅／悬浮提醒。"

    private fun LinearLayout.settingSwitch(text: String, key: String, checked: Boolean,
        update: (UserSettings, Boolean) -> UserSettings) {
        checkbox(text, checked).apply {
            tag = key
            // Attach after initial state; loading the page must never write settings.
            setOnCheckedChangeListener { _, selected ->
                if (!syncingSettings) actions.saveSettings(update(settingsStore.settings(), selected))
            }
        }
    }

    private fun refreshSettingsPage() {
        val value = settingsStore.settings()
        // Keep views and scroll position, including when a service action changes a setting.
        syncingSettings = true
        try {
            mapOf("notifyNewProblems" to value.notifyNewProblems, "notifyAutoSubmissions" to value.notifyAutoSubmissions, "autoAnalyze" to value.autoAnalyze,
                "autoSubmit" to value.autoSubmit, "autoExpandOnProblem" to value.autoExpandOnProblem,
                "includeCurrentSlide" to value.includeCurrentSlide, "keepScreenOn" to value.keepScreenOn).forEach { (tag, checked) ->
                container.findViewWithTag<MaterialSwitch>(tag)?.let { if (it.isChecked != checked) it.isChecked = checked }
            }
            container.findViewWithTag<Spinner>("classroomEnvironment")?.let {
                if (it.selectedItemPosition != state.environment.ordinal) it.setSelection(state.environment.ordinal)
            }
            container.findViewWithTag<TextView>("notificationPermissionHint")?.text = notificationPermissionHint()
        } finally { syncingSettings = false }
    }

    private fun LinearLayout.problemCard(problem: Problem) {
        label(plain(problem.prompt).ifBlank { "请查看题目所在的课件图片" }, bold = true)
        problem.options.forEachIndexed { index, option -> label("${'A' + index}. ${plain(option)}") }
        val slide = state.connected?.presentation?.slides?.find { it.id == problem.slideId }
        slide?.imageUrl?.let { url ->
            addView(ImageView(context).apply {
                contentDescription = "本题课件图片"; adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER
                loadRemoteImage(this, url)
                setOnClickListener { show(Page.COURSEWARE) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(200)))
        }
        val type = when(problem.type) {
            com.zaytsev.yuketanghelper.model.ProblemType.SINGLE_CHOICE -> "单选题"
            com.zaytsev.yuketanghelper.model.ProblemType.MULTIPLE_CHOICE -> "多选题"
            com.zaytsev.yuketanghelper.model.ProblemType.POLL -> "投票"
            com.zaytsev.yuketanghelper.model.ProblemType.FILL_BLANK -> "填空题"
            com.zaytsev.yuketanghelper.model.ProblemType.SUBJECTIVE -> "主观题"
            else -> "未知题型"
        }
        hint(type + (problem.deadlineAt?.let { " · 截止 " + java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.ROOT).format(java.util.Date(it)) } ?: ""))
    }

    private fun problemSummary(problem: Problem): String {
        val slide = state.connected?.presentation?.slides?.find {
            it.id == problem.slideId && it.problem?.presentationId == problem.presentationId
        }
        val page = slide?.let { "课件第 ${it.index + 1} 页" } ?: "页码未同步"
        val publication = when {
            problem.deadlineAt?.let { it <= System.currentTimeMillis() } == true -> "已截止"
            problem.unlockedAt != null || problem.answered -> "已发布"
            else -> "未发布"
        }
        return "$page · $publication · ${if (problem.answered) "已作答" else "未作答"}" +
            if (state.question(problem).submissionUnknown) " · 提交待核对" else ""
    }

    private fun submittedAnswerText(problem: Problem): String {
        val answer = problem.submittedAnswer
            ?: return "已作答，暂未获取到答案内容。可重新同步课堂，或打开网页查看。"
        return buildList {
            answer.values.forEachIndexed { index, value ->
                add(when (problem.type) {
                    ProblemType.SINGLE_CHOICE, ProblemType.MULTIPLE_CHOICE, ProblemType.POLL -> {
                        val option = value.singleOrNull()?.takeIf { it in 'A'..'Z' }?.let { problem.options.getOrNull(it - 'A') }
                        if (option != null) "$value. ${plain(option)}" else value.ifBlank { "（空）" }
                    }
                    ProblemType.FILL_BLANK -> "第 ${index + 1} 空：${value.ifBlank { "（空）" }}"
                    else -> plain(value).ifBlank { "（空）" }
                })
            }
            if (answer.pictureCount > 0) add("图片：${answer.pictureCount} 张，请在网页查看附件")
            if (answer.videoCount > 0) add("视频：${answer.videoCount} 个，请在网页查看附件")
        }.joinToString("\n")
    }

    private fun refreshProblemSummary() {
        val problem = state.connected?.problems?.find { it.id == displayedProblemId } ?: return
        container.findViewWithTag<TextView>("problemSummary")?.text = problemSummary(problem)
        container.findViewWithTag<TextView>("problemActionStatus")?.text = problemActionStatus(problem)
        container.findViewWithTag<TextView>("submittedAnswerHeading")?.visibility = if (problem.answered) View.VISIBLE else View.GONE
        container.findViewWithTag<TextView>("submittedAnswerContent")?.apply {
            visibility = if (problem.answered) View.VISIBLE else View.GONE
            text = submittedAnswerText(problem)
        }
    }

    private fun problemActionStatus(problem: Problem): String {
        val status = state.question(problem).status
        if (status != "等待作答") return status
        return when {
            problem.answered -> "已同步作答记录"
            problem.deadlineAt?.let { it <= System.currentTimeMillis() } == true -> "题目已截止"
            problem.unlockedAt == null -> "等待教师发布题目"
            else -> status
        }
    }

    private fun scheduleProblemDeadline() {
        container.removeCallbacks(deadlineRefresh)
        val deadline = state.connected?.problems?.find { it.id == displayedProblemId }?.deadlineAt ?: return
        val delay = deadline - System.currentTimeMillis()
        if (delay > 0) container.postDelayed(deadlineRefresh, delay + 25)
    }

    @Suppress("DEPRECATION")
    private fun plain(text: String): String = if (Build.VERSION.SDK_INT >= 24) Html.fromHtml(text, Html.FROM_HTML_MODE_LEGACY).toString() else Html.fromHtml(text).toString()

    private fun page(title: String, content: LinearLayout.() -> Unit): View {
        val body = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(24))
            GlassUi.card(this)
            label(title, bold = true, size = 26f)
            content()
        }
        return NestedScrollView(context).apply {
            isFillViewport = true
            clipToPadding = false
            setPadding(dp(10), dp(4), dp(10), dp(4))
            addView(body)
        }
    }

    private fun LinearLayout.status() = hint(state.status)

    private fun LinearLayout.label(text: String, bold: Boolean = false, size: Float = 15f): TextView =
        TextView(context).also { view ->
            view.text = text
            view.textSize = size
            view.setTextColor(GlassUi.ink)
            view.setPadding(0, dp(8), 0, dp(6))
            view.setLineSpacing(dp(3).toFloat(), 1.08f)
            if (bold) view.setTypeface(view.typeface, android.graphics.Typeface.BOLD)
            addView(view, matchWrap())
        }

    private fun LinearLayout.hint(text: String): TextView = label(text, size = 13f).apply {
        setTextColor(GlassUi.secondary)
    }

    private fun LinearLayout.selectable(text: String): TextView = label(text).apply {
        setTextIsSelectable(true)
        setPadding(dp(12), dp(10), dp(12), dp(10))
        GlassUi.card(this, GlassUi.control, 16f)
    }

    private fun LinearLayout.input(label: String, value: String, sensitive: Boolean = false): TextInputLayout {
        val edit = TextInputEditText(context).apply {
            setText(value)
            // API keys use the normal keyboard so users can paste from the clipboard.
            inputType = if (sensitive) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            if (sensitive) setSingleLine(true) else maxLines = 8
            minimumHeight = dp(56)
            textSize = 15f
            setTextColor(GlassUi.ink)
            setPadding(dp(16), dp(16), dp(16), dp(14))
            if (sensitive && Build.VERSION.SDK_INT >= 26) importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        return TextInputLayout(context).also { layout ->
            layout.hint = label
            layout.boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
            layout.setBoxCornerRadii(dp(16).toFloat(), dp(16).toFloat(), dp(16).toFloat(), dp(16).toFloat())
            layout.boxBackgroundColor = GlassUi.control
            layout.boxStrokeColor = GlassUi.accent
            layout.defaultHintTextColor = android.content.res.ColorStateList.valueOf(GlassUi.secondary)
            layout.setPadding(0, dp(6), 0, dp(4))
            layout.addView(edit)
            addView(layout, matchWrap())
        }
    }

    private fun LinearLayout.checkbox(text: String, checked: Boolean): MaterialSwitch = MaterialSwitch(context).also {
        it.text = text
        it.textSize = 14f
        it.setTextColor(GlassUi.ink)
        it.isChecked = checked
        it.minimumHeight = dp(56)
        it.setPadding(dp(14), dp(10), dp(14), dp(10))
        GlassUi.surface(it, 20f, interactive = false)
        addView(it, matchWrap())
    }

    private fun MaterialAlertDialogBuilder.showGlass(): androidx.appcompat.app.AlertDialog = show().also { dialog ->
        listOf(android.content.DialogInterface.BUTTON_POSITIVE, android.content.DialogInterface.BUTTON_NEGATIVE).forEach { which ->
            dialog.getButton(which)?.let { GlassUi.button(it, which == android.content.DialogInterface.BUTTON_POSITIVE) }
        }
    }

    private fun LinearLayout.primaryButton(text: String, enabled: Boolean = true, click: () -> Unit) {
        addView(MaterialButton(context).apply {
            this.text = text
            GlassUi.button(this, primary = true)
            isEnabled = enabled
            setOnClickListener { container.clearFocus(); click() }
        }, matchWrap())
    }

    private fun LinearLayout.secondaryButton(text: String, enabled: Boolean = true, click: () -> Unit) {
        addView(MaterialButton(context, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            this.text = text
            GlassUi.button(this)
            isEnabled = enabled
            setOnClickListener { container.clearFocus(); click() }
        }, matchWrap())
    }

    private fun LinearLayout.sectionButton(title: String, detail: String, selected: Boolean, click: () -> Unit) {
        addView(MaterialButton(context, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = (if (selected) "✓ " else "") + title + "\n" + detail
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            isAllCaps = false
            GlassUi.button(this, primary = selected)
            setOnClickListener { container.clearFocus(); click() }
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
            GlassUi.button(this)
            setOnClickListener { container.clearFocus(); click() }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(3), dp(4), dp(3), dp(4)) })
    }

    private fun loadRemoteImage(view: ImageView, url: String) {
        com.zaytsev.yuketanghelper.ui.SlideImages.load(view, url)
    }

    private fun matchWrap() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { setMargins(0, dp(3), 0, dp(3)) }

    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
}
