package com.zaytsev.yuketanghelper

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.zaytsev.yuketanghelper.databinding.ActivityMainBinding
import com.zaytsev.yuketanghelper.model.AiAnswer
import com.zaytsev.yuketanghelper.model.AiProfile
import com.zaytsev.yuketanghelper.model.Environment
import com.zaytsev.yuketanghelper.network.AiClient
import com.zaytsev.yuketanghelper.network.YuketangClient
import com.zaytsev.yuketanghelper.storage.SettingsStore
import com.zaytsev.yuketanghelper.ui.AppState
import com.zaytsev.yuketanghelper.ui.AssistantController
import com.zaytsev.yuketanghelper.web.UrlPolicy
import com.zaytsev.yuketanghelper.web.WebSessionCredentials
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity(), AssistantController.Actions {
    private lateinit var binding: ActivityMainBinding
    private lateinit var bottomSheet: BottomSheetBehavior<LinearLayout>
    private lateinit var settingsStore: SettingsStore
    private lateinit var client: YuketangClient
    private lateinit var assistant: AssistantController
    private val ai = AiClient()
    private val state = AppState()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(0, bars.top, 0, bars.bottom)
            insets
        }
        settingsStore = SettingsStore(this)
        configureWebView()
        client = YuketangClient(WebSessionCredentials(binding.webView, settingsStore))
        assistant = AssistantController(this, binding.assistantContent, state, settingsStore, this) { page ->
            val tabId = when (page) {
                AssistantController.Page.CLASSROOM -> binding.tabClassroom.id
                AssistantController.Page.PROBLEMS -> binding.tabProblems.id
                AssistantController.Page.AI -> binding.tabAi.id
                AssistantController.Page.COURSEWARE -> binding.tabCourseware.id
                AssistantController.Page.MODELS -> binding.tabModels.id
                AssistantController.Page.SETTINGS -> binding.tabSettings.id
            }
            if (binding.assistantTabs.checkedButtonId != tabId) binding.assistantTabs.check(tabId)
        }
        configureToolbar()
        configureSheet()
        assistant.show()
        binding.webView.loadUrl(state.environment.startUrl)

        onBackPressedDispatcher.addCallback(this) {
            when {
                bottomSheet.state == BottomSheetBehavior.STATE_EXPANDED -> bottomSheet.state = BottomSheetBehavior.STATE_COLLAPSED
                binding.webView.canGoBack() -> binding.webView.goBack()
                else -> finish()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false)
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(binding.webView, true)
        }
        binding.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
        }
        // The Rain Classroom desktop pages use a wide fixed layout. Start zoomed out so
        // the login card and navigation remain reachable on a phone, while preserving
        // pinch-to-zoom for normal use.
        binding.webView.setInitialScale(50)
        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                binding.pageProgress.progress = newProgress
                binding.pageProgress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }
        }
        binding.webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                handleNavigation(request.url.toString())

            @Deprecated("Deprecated in Android")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = handleNavigation(url)

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                updateNavigation()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                CookieManager.getInstance().flush()
                updateNavigation()
            }
        }
        binding.webView.setDownloadListener { url, _, _, _, _ -> openExternal(url) }
    }

    private fun handleNavigation(url: String): Boolean {
        if (UrlPolicy.isAllowed(url)) return false
        openExternal(url)
        return true
    }

    private fun openExternal(url: String) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            .onFailure { toast("无法打开外部链接") }
    }

    private fun configureToolbar() {
        binding.environmentSpinner.adapter = ArrayAdapter(
            this,
            R.layout.spinner_item,
            Environment.entries.map { it.label },
        ).apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        binding.environmentSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            private var initialized = false
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val next = Environment.entries[position]
                if (!initialized) {
                    initialized = true
                    return
                }
                if (next == state.environment) return
                client.close()
                state.environment = next
                state.lessons = emptyList()
                state.connected = null
                state.selectedProblem = null
                state.aiAnswer = null
                state.status = "已切换到 ${next.label}，请登录后刷新课堂"
                binding.webView.loadUrl(next.startUrl)
                assistant.show()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        binding.backButton.setOnClickListener { if (binding.webView.canGoBack()) binding.webView.goBack() }
        binding.forwardButton.setOnClickListener { if (binding.webView.canGoForward()) binding.webView.goForward() }
        binding.reloadButton.setOnClickListener { binding.webView.reload() }
        binding.assistantButton.setOnClickListener {
            bottomSheet.state = if (bottomSheet.state == BottomSheetBehavior.STATE_EXPANDED) {
                BottomSheetBehavior.STATE_COLLAPSED
            } else {
                BottomSheetBehavior.STATE_EXPANDED
            }
        }
    }

    private fun configureSheet() {
        bottomSheet = BottomSheetBehavior.from(binding.assistantSheet).apply {
            state = BottomSheetBehavior.STATE_COLLAPSED
            isFitToContents = true
            halfExpandedRatio = 0.55f
        }
        binding.sheetHeader.setOnClickListener {
            bottomSheet.state = if (bottomSheet.state == BottomSheetBehavior.STATE_EXPANDED) {
                BottomSheetBehavior.STATE_COLLAPSED
            } else {
                BottomSheetBehavior.STATE_EXPANDED
            }
        }
        val tabs = mapOf(
            binding.tabClassroom.id to AssistantController.Page.CLASSROOM,
            binding.tabProblems.id to AssistantController.Page.PROBLEMS,
            binding.tabAi.id to AssistantController.Page.AI,
            binding.tabCourseware.id to AssistantController.Page.COURSEWARE,
            binding.tabModels.id to AssistantController.Page.MODELS,
            binding.tabSettings.id to AssistantController.Page.SETTINGS,
        )
        binding.assistantTabs.check(binding.tabClassroom.id)
        binding.assistantTabs.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (isChecked) tabs[checkedId]?.let(assistant::show)
        }
    }

    override fun refreshLessons() = runAction("课堂刷新失败") {
        state.lessons = client.listLessons(state.environment)
        state.status = if (state.lessons.isEmpty()) "当前没有进行中的课堂" else "找到 ${state.lessons.size} 个课堂"
    }

    override fun connectLesson(index: Int) = runAction("课堂连接失败") {
        val lesson = state.lessons.getOrNull(index) ?: error("课堂不存在")
        state.connected = client.connectLesson(state.environment, lesson, ::onProblemUnlocked)
        state.selectedProblem = state.connected?.problems?.firstOrNull()
        state.slideIndex = 0
        state.status = "已连接 ${lesson.title.ifBlank { lesson.id }}"
    }

    override fun selectProblem(index: Int) {
        val problem = state.connected?.problems?.getOrNull(index) ?: return
        state.selectedProblem = problem
        state.connected?.presentation?.slides?.indexOfFirst { it.id == problem.slideId }
            ?.takeIf { it >= 0 }
            ?.let { state.slideIndex = it }
        state.aiAnswer = null
        assistant.show(AssistantController.Page.PROBLEMS)
    }

    override fun analyzeProblem() = runAction("AI 分析失败") {
        val problem = state.selectedProblem ?: error("请先选择题目")
        val profile = settingsStore.aiProfile() ?: error("请先在“模型”页配置 AI 服务")
        val image = currentSlideImage()
        state.aiAnswer = ai.answerProblem(profile, problem, image)
        state.status = "AI 建议已生成，请核对后提交"
        assistant.show(AssistantController.Page.AI)
    }

    override fun submitAnswer(value: String) = runAction("答案提交失败") {
        val problem = state.selectedProblem ?: error("请先选择题目")
        client.submitAnswer(state.environment, problem, value)
        state.status = "答案已提交"
    }

    override fun askCourseware(question: String) = runAction("课件问答失败") {
        val profile = settingsStore.aiProfile() ?: error("请先在“模型”页配置 AI 服务")
        val response = ai.askCourseware(profile, question, currentSlideImage())
        state.aiAnswer = AiAnswer("", "", response)
        state.status = "课件回答已生成"
    }

    override fun changeSlide(delta: Int) {
        val slides = state.connected?.presentation?.slides.orEmpty()
        if (slides.isEmpty()) return
        state.slideIndex = (state.slideIndex + delta).coerceIn(slides.indices)
        state.aiAnswer = null
        assistant.show(AssistantController.Page.COURSEWARE)
    }

    override fun saveAndTestProfile(profile: AiProfile) = runAction("模型连接失败") {
        require(profile.baseUrl.isNotBlank() && profile.apiKey.isNotBlank() && profile.model.isNotBlank()) {
            "Base URL、API Key 和文本模型不能为空"
        }
        val models = ai.test(profile)
        require(models.isEmpty() || profile.model in models) { "文本模型不在服务返回的模型列表中" }
        settingsStore.saveAiProfile(profile)
        state.status = "模型连接成功"
    }

    private fun onProblemUnlocked(problem: com.zaytsev.yuketanghelper.model.Problem) {
        runOnUiThread {
            state.selectedProblem = problem
            state.aiAnswer = null
            state.status = "检测到新题目"
            val settings = settingsStore.settings()
            if (settings.autoExpandOnProblem) bottomSheet.state = BottomSheetBehavior.STATE_EXPANDED
            assistant.show(AssistantController.Page.PROBLEMS)
            if (settings.autoAnalyze) analyzeProblem()
        }
    }

    private fun currentSlideImage(): String? {
        if (!settingsStore.settings().includeCurrentSlide) return null
        val slides = state.connected?.presentation?.slides.orEmpty()
        return slides.getOrNull(state.slideIndex)?.imageUrl
    }

    private fun runAction(errorTitle: String, action: suspend () -> Unit) {
        if (state.busy) return
        lifecycleScope.launch {
            state.busy = true
            assistant.show()
            runCatching { action() }
                .onFailure {
                    state.status = "$errorTitle：${it.message ?: "未知错误"}"
                    toast(state.status)
                }
            state.busy = false
            assistant.show()
        }
    }

    private fun updateNavigation() {
        binding.backButton.isEnabled = binding.webView.canGoBack()
        binding.forwardButton.isEnabled = binding.webView.canGoForward()
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    override fun onDestroy() {
        client.close()
        binding.webView.apply {
            stopLoading()
            clearHistory()
            removeAllViews()
            destroy()
        }
        super.onDestroy()
    }
}
