package com.zaytsev.yuketanghelper

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.zaytsev.yuketanghelper.databinding.ActivityMainBinding
import com.zaytsev.yuketanghelper.model.*
import com.zaytsev.yuketanghelper.session.ClassroomService
import com.zaytsev.yuketanghelper.session.ProblemNotifications
import com.zaytsev.yuketanghelper.ui.AssistantController
import com.zaytsev.yuketanghelper.ui.SlideImages
import com.zaytsev.yuketanghelper.web.UrlPolicy
import kotlinx.coroutines.*

class MainActivity : AppCompatActivity(), AssistantController.Actions {
    private lateinit var binding: ActivityMainBinding
    private var assistantVisible = true
    private lateinit var assistant: AssistantController
    private val session get() = (application as HelperApplication).session
    private val state get() = session.state
    private lateinit var observer: com.zaytsev.yuketanghelper.web.ClassroomObserver
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var exportUrl: String? = null
    private val listener: () -> Unit = { render() }
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (!allowed) toast("通知未开启，无法显示新题目提醒；请在设置 → 系统通知设置中允许通知")
        if (::assistant.isInitialized) assistant.refresh()
    }
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(it.resultCode, it.data)); fileCallback = null
    }
    private val saveImage = registerForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        val url = exportUrl; exportUrl = null
        if (uri != null && url != null) lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val bytes = SlideImages.bytes(url)
                    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    val options = android.graphics.BitmapFactory.Options().apply {
                        inSampleSize = 1
                        while (bounds.outWidth / inSampleSize > 2048 || bounds.outHeight / inSampleSize > 2048) inSampleSize *= 2
                    }
                    val bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: error("图片解析失败")
                    contentResolver.openOutputStream(uri)?.use { output -> check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) }
                        ?: error("无法写入文件")
                    bitmap.recycle()
                }
                toast("课件图片已保存")
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { toast("图片保存失败，请重试") }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        androidx.core.view.WindowCompat.getInsetsController(window, binding.root).isAppearanceLightStatusBars = true
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        configureWebView()
        assistant = AssistantController(this, binding.assistantContent, state, session.settings, this) { page ->
            val button = when(page) {
                AssistantController.Page.CLASSROOM -> binding.tabClassroom
                AssistantController.Page.PROBLEMS -> binding.tabProblems
                AssistantController.Page.AI -> binding.tabAi
                AssistantController.Page.COURSEWARE -> binding.tabCourseware
                AssistantController.Page.MODELS -> binding.tabModels
                AssistantController.Page.SETTINGS, AssistantController.Page.ABOUT -> binding.tabSettings
            }
            if (binding.assistantTabs.checkedButtonId != button.id) binding.assistantTabs.check(button.id)
            button.post { button.requestRectangleOnScreen(android.graphics.Rect(0, 0, button.width, button.height), false) }
        }
        configureSheet()
        configureToolbar()
        session.observe(listener)
        session.onNewProblem = {
            if (session.settings.settings().autoExpandOnProblem && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) {
                showAssistant(true)
                assistant.show(AssistantController.Page.PROBLEMS)
            }
        }
        assistant.show()
        if (savedInstanceState == null || binding.webView.restoreState(savedInstanceState) == null) binding.webView.loadUrl(state.environment.startUrl)
        render()
        if (savedInstanceState == null) openNotifiedProblem(intent)
        onBackPressedDispatcher.addCallback(this) {
            when {
                assistantVisible && assistant.page == AssistantController.Page.ABOUT -> assistant.show(AssistantController.Page.SETTINGS)
                assistantVisible -> showAssistant(false)
                binding.webView.canGoBack() -> binding.webView.goBack()
                else -> moveTaskToBack(true)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(binding.webView, true) }
        binding.webView.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false); javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            useWideViewPort = true; loadWithOverviewMode = true
            builtInZoomControls = true; displayZoomControls = false
        }
        observer = com.zaytsev.yuketanghelper.web.ClassroomObserver(binding.webView, session).also { it.install() }
        // The official login page has a fixed desktop-width layout. Fit it initially; pinch zoom remains enabled.
        val pageWidthDp = resources.displayMetrics.widthPixels / resources.displayMetrics.density
        binding.webView.setInitialScale((pageWidthDp / 1280f * 100).toInt().coerceIn(25, 100))
        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, progress: Int) {
                binding.pageProgress.progress = progress
                binding.pageProgress.visibility = if(progress in 1..99) View.VISIBLE else View.GONE
            }
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = callback
                return try { filePicker.launch(params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).setType("*/*")); true }
                catch (_: Exception) { fileCallback?.onReceiveValue(null); fileCallback = null; false }
            }
        }
        binding.webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                if (request.isForMainFrame) navigate(request.url.toString()) else false
            @Deprecated("Deprecated in Android")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = navigate(url)
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) { observer.pageStarted(url) }
            override fun onPageFinished(view: WebView?, url: String?) {
                CookieManager.getInstance().flush(); updateNavigation()
                lifecycleScope.launch { session.credentials.capturePage(binding.webView, state.environment) }
            }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) toast("网页加载失败，请检查网络后点击刷新")
            }
            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                // Recreate the UI; the native classroom session and foreground service remain independent.
                (view?.parent as? android.view.ViewGroup)?.removeView(view); view?.destroy()
                recreate()
                return true
            }
        }
        binding.webView.setDownloadListener { url, _, _, _, _ -> openExternal(url) }
    }

    private fun navigate(url: String): Boolean {
        if (UrlPolicy.isAllowed(url)) return false
        openExternal(url); return true
    }
    private fun openExternal(url: String) {
        val uri = Uri.parse(url)
        if (uri.scheme !in listOf("https", "http", "weixin", "alipays")) { toast("此链接暂不支持，请使用系统浏览器打开"); return }
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
            .onFailure { toast("没有可打开此链接的应用") }
    }
    private fun configureToolbar() {
        com.zaytsev.yuketanghelper.ui.GlassUi.surface(binding.browserToolbar, 30f, interactive = false)
        listOf(binding.backButton, binding.forwardButton, binding.reloadButton).forEach {
            com.zaytsev.yuketanghelper.ui.GlassUi.surface(it, 24f)
        }
        com.zaytsev.yuketanghelper.ui.GlassUi.button(binding.settingsButton)
        binding.settingsButton.apply {
            textSize = 14f
            val density = resources.displayMetrics.density
            setPadding((8 * density).toInt(), 0, (8 * density).toInt(), 0)
            minHeight = (48 * density).toInt()
            minimumHeight = minHeight
        }
        binding.appTitle.text = getString(R.string.toolbar_title_version, BuildConfig.VERSION_NAME)
        binding.appTitle.contentDescription = getString(R.string.app_title_version, BuildConfig.VERSION_NAME)
        binding.backButton.setOnClickListener { if (binding.webView.canGoBack()) binding.webView.goBack() }
        binding.forwardButton.setOnClickListener { if (binding.webView.canGoForward()) binding.webView.goForward() }
        binding.reloadButton.setOnClickListener { if (assistantVisible) refreshLessons() else binding.webView.reload() }
        binding.settingsButton.setOnClickListener { toggleSheet() }
        binding.appTitle.setOnClickListener {
            showAssistant(true)
            assistant.show(AssistantController.Page.CLASSROOM)
        }
    }
    private fun configureSheet() {
        binding.sheetHeader.setOnClickListener { toggleSheet() }
        val tabs = mapOf(binding.tabClassroom.id to AssistantController.Page.CLASSROOM,
            binding.tabProblems.id to AssistantController.Page.PROBLEMS, binding.tabAi.id to AssistantController.Page.AI,
            binding.tabCourseware.id to AssistantController.Page.COURSEWARE, binding.tabModels.id to AssistantController.Page.MODELS,
            binding.tabSettings.id to AssistantController.Page.SETTINGS)
        binding.assistantTabs.addOnButtonCheckedListener { _, id, checked ->
            if (checked && tabs[id] != assistant.page) tabs[id]?.let(assistant::show)
        }
    }
    private fun toggleSheet() {
        binding.assistantContent.clearFocus()
        showAssistant(!assistantVisible)
    }
    private fun showAssistant(visible: Boolean) {
        assistantVisible = visible
        binding.assistantSheet.visibility = if (visible) View.VISIBLE else View.GONE
        if (visible) assistant.refresh()
        else androidx.core.view.WindowCompat.getInsetsController(window, binding.root).hide(WindowInsetsCompat.Type.ime())
        updateNavigation()
    }
    private fun render() {
        if (!::assistant.isInitialized) return
        binding.sheetTitle.text = if (state.active) "${if (state.online) "上课中" else "重连中"} · ${if(session.settings.settings().autoSubmit) "自动回答开" else "自动提交关"} · 网页"
            else "课堂未连接 · 点击打开登录网页"
        if (state.active && session.settings.settings().keepScreenOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        assistant.refresh()
        updateNavigation()
    }
    override fun refreshLessons() {
        lifecycleScope.launch { session.credentials.capturePage(binding.webView, state.environment); session.refreshLessons() }
    }
    override fun connectLesson(index: Int) {
        val lesson = state.lessons.getOrNull(index) ?: return
        requestNotificationPermission()
        session.connect(lesson)
        binding.webView.loadUrl("${state.environment.origin}/lesson/fullscreen/v3/${Uri.encode(lesson.id)}")
        try { ContextCompat.startForegroundService(this, Intent(this, ClassroomService::class.java)) }
        catch (_: RuntimeException) { session.report("后台服务启动失败，请保持应用在前台") }
    }
    override fun selectProblem(index: Int) { state.connected?.problems?.getOrNull(index)?.let(session::selectProblem); assistant.show(AssistantController.Page.PROBLEMS) }
    override fun analyzeProblem() { state.selectedProblem?.let { session.analyze(it) } }
    override fun submitAnswer(problemId: String, value: String, forceRetry: Boolean) {
        state.connected?.problems?.find { it.id == problemId }?.let { session.submit(it, value, forceRetry) }
    }
    override fun askCourseware(question: String) { session.ask(question, assistant.page == AssistantController.Page.COURSEWARE) }
    override fun changeSlide(delta: Int) {
        val slides = state.connected?.presentation?.slides.orEmpty()
        if (slides.isEmpty()) return
        state.slideIndex = (state.slideIndex + delta).coerceIn(slides.indices)
        assistant.show(AssistantController.Page.COURSEWARE)
    }
    override fun saveAndTestProfile(profile: AiProfile, test: Boolean) { session.saveProfile(profile, test) }
    override fun disconnect() { session.disconnect(); stopService(Intent(this, ClassroomService::class.java)) }
    override fun resync() { session.resync() }
    override fun changeEnvironment(environment: Environment) {
        if (environment == state.environment) return
        session.switchEnvironment(environment)
        stopService(Intent(this, ClassroomService::class.java))
        binding.webView.loadUrl(environment.startUrl)
    }
    override fun saveSettings(value: UserSettings) {
        val wasEnabled = session.settings.settings().notifyNewProblems
        session.saveSettings(value)
        if (value.notifyNewProblems && !wasEnabled) requestNotificationPermission()
    }
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    override fun openNotificationSettings() {
        val target = if (Build.VERSION.SDK_INT >= 26) Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)
            .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, ProblemNotifications.CHANNEL)
        else Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        runCatching { startActivity(target) }.onFailure { toast("请在手机系统设置中允许雨课堂助手通知") }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openNotifiedProblem(intent)
    }
    private fun openNotifiedProblem(source: Intent?) {
        if (source?.action != ProblemNotifications.ACTION_OPEN) return
        showAssistant(true)
        val lessonMatches = state.active && state.environment.name == source.getStringExtra(ProblemNotifications.EXTRA_ENVIRONMENT) &&
            state.connected?.lesson?.id == source.getStringExtra(ProblemNotifications.EXTRA_LESSON)
        val problem = if (lessonMatches) state.connected?.problems?.find { it.id == source.getStringExtra(ProblemNotifications.EXTRA_PROBLEM) } else null
        if (problem != null) {
            session.selectProblem(problem)
            assistant.show(AssistantController.Page.PROBLEMS)
        } else {
            assistant.show(AssistantController.Page.CLASSROOM)
            toast("此提醒对应的课堂已断开或题目未同步，请进入对应课堂查看")
        }
    }
    override fun retrySubmission() { state.selectedProblem?.let(session::allowManualRetry) }
    override fun openWebsite() { showAssistant(false) }
    override fun cancelAi() { session.cancelChat() }
    override fun clearProfile() { session.clearProfile(); assistant.show(AssistantController.Page.MODELS) }
    override fun exportSlide() {
        exportUrl = state.connected?.presentation?.slides?.getOrNull(state.slideIndex)?.imageUrl
        if (exportUrl == null) toast("本页没有可保存的图片") else saveImage.launch("课件-${state.slideIndex + 1}.png")
    }
    private fun updateNavigation() {
        binding.backButton.isEnabled = binding.webView.canGoBack()
        binding.forwardButton.isEnabled = binding.webView.canGoForward()
        binding.backButton.visibility = if (assistantVisible) View.GONE else View.VISIBLE
        binding.forwardButton.visibility = if (!assistantVisible && resources.configuration.screenWidthDp >= 380) View.VISIBLE else View.GONE
        binding.settingsButton.text = getString(if (assistantVisible) R.string.close_assistant else R.string.open_assistant)
        binding.settingsButton.contentDescription = binding.settingsButton.text
        binding.reloadButton.contentDescription = if (assistantVisible) "刷新课堂" else "刷新网页"
    }
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    override fun onSaveInstanceState(outState: Bundle) { binding.webView.saveState(outState); super.onSaveInstanceState(outState) }
    override fun onResume() { super.onResume(); if (::binding.isInitialized) { binding.webView.onResume(); render() } }
    override fun onPause() { if (::binding.isInitialized) { binding.webView.onPause(); CookieManager.getInstance().flush() }; super.onPause() }
    override fun onDestroy() {
        session.unobserve(listener); session.onNewProblem = null
        fileCallback?.onReceiveValue(null); fileCallback = null
        binding.webView.apply { stopLoading(); (parent as? android.view.ViewGroup)?.removeView(this); destroy() }
        super.onDestroy()
    }
}
