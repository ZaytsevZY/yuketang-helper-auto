package com.zaytsev.yuketanghelper.session

import android.content.Context
import com.zaytsev.yuketanghelper.answer.AnswerParser
import com.zaytsev.yuketanghelper.model.*
import com.zaytsev.yuketanghelper.network.*
import com.zaytsev.yuketanghelper.storage.SettingsStore
import com.zaytsev.yuketanghelper.ui.AppState
import com.zaytsev.yuketanghelper.ui.ModelStatusKind
import com.zaytsev.yuketanghelper.web.WebSessionCredentials
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject

/** All mutable classroom state is owned by the main dispatcher. Network calls are cancellable. */
class ClassroomSession(
    context: Context,
    clientOverride: YuketangClient? = null,
    private val ai: AiClient = AiClient(),
    private val autoSubmitDelayMs: Long = 3000,
) {
    val settings = SettingsStore(context.applicationContext)
    val problemNotifications = ProblemNotifications(context)
    val credentials = WebSessionCredentials(settings)
    val state = AppState(environment = settings.environment())
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val client = clientOverride ?: YuketangClient(credentials)
    private val aiSlots = Semaphore(2)
    private val ledger = context.getSharedPreferences("submission_ledger", Context.MODE_PRIVATE)
    private var sessionJob = SupervisorJob(scope.coroutineContext[Job])
    private var lessonScope = CoroutineScope(sessionJob + Dispatchers.Main.immediate)
    private var generation = 0L
    private var reconnect: Job? = null
    private var chatJob: Job? = null
    private var profileJob: Job? = null
    private var chatGeneration = 0L
    private var reconnectCount = 0
    private var messages = Channel<String>(Channel.UNLIMITED)
    private val pending = linkedMapOf<String, YuketangParser.Unlock>()
    private val answerJobs = mutableMapOf<String, Job>()
    private val listeners = mutableSetOf<() -> Unit>()
    var onNewProblem: (() -> Unit)? = null
    var onSessionEnded: (() -> Unit)? = null

    fun observe(listener: () -> Unit) { listeners.add(listener) }
    fun unobserve(listener: () -> Unit) { listeners.remove(listener) }
    fun changed() { listeners.toList().forEach { it() } }
    fun report(message: String) {
        state.status = message
        state.events.add(0, java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.ROOT).format(java.util.Date()) + "  " + message)
        if (state.events.size > 60) state.events.removeAt(state.events.lastIndex)
        changed()
    }

    fun switchEnvironment(environment: Environment) {
        disconnect()
        state.environment = environment
        settings.saveEnvironment(environment)
        state.lessons = emptyList()
        state.connected = null
        state.selectedProblem = null
        state.questions.clear()
        state.courseAnswers.clear()
        report("已切换到 ${environment.label}，请登录后刷新课堂")
    }

    fun refreshLessons() {
        if (state.busy) return
        val current = generation
        val env = state.environment
        state.busy = true; changed()
        scope.launch {
            try {
                val lessons = client.listLessons(env)
                if (current == generation) {
                    state.lessons = lessons
                    report(if (lessons.isEmpty()) "当前没有进行中的课堂" else "找到 ${lessons.size} 个课堂，点击进入")
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (current == generation) report(e.message ?: "课堂刷新失败") }
            finally { if (current == generation) { state.busy = false; changed() } }
        }
    }

    fun connect(lesson: Lesson) {
        disconnect(notify = false)
        state.questions.clear(); state.courseAnswers.clear(); state.selectedProblem = null
        state.connected = ConnectedLesson(lesson, null, emptyList())
        state.slideIndex = 0; state.active = true; state.busy = true
        val current = generation
        report("正在连接 ${lesson.title.ifBlank { lesson.id }}")
        val channel = messages
        lessonScope.launch {
            for (text in channel) {
                try { handleMessage(text) }
                catch (e: CancellationException) { throw e }
                catch (e: Exception) { report(e.message ?: "课堂消息处理失败，可点击重新同步") }
            }
        }
        lessonScope.launch {
            try {
                client.checkin(state.environment, lesson)
                lesson.presentationId?.let {
                    try { loadPresentation(it) }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) { report("已签到，课件暂未同步；可在连接后点击重新同步") }
                }
                openSocket(current)
                report("已签到，正在同步课堂消息")
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { report(e.message ?: "课堂连接失败"); scheduleReconnect(current) }
            finally { if (current == generation) { state.busy = false; changed() } }
        }
    }

    private suspend fun openSocket(current: Long) {
        val lesson = state.connected?.lesson ?: return
        client.openSocket(state.environment, lesson, { text ->
            scope.launch { if (current == generation) messages.trySend(text) }
        }, { online ->
            scope.launch {
                if (current != generation || !state.active) return@launch
                state.online = online
                if (online) {
                    reconnectCount = 0
                    report("课堂已连接 · ${state.connected?.problems?.size ?: 0} 道题目")
                } else {
                    report("课堂连接中断，正在自动重连")
                    scheduleReconnect(current)
                }
            }
        })
    }

    private fun scheduleReconnect(current: Long) {
        if (reconnect?.isActive == true || current != generation || !state.active) return
        reconnect = lessonScope.launch {
            delay((1000L shl reconnectCount.coerceAtMost(5)).coerceAtMost(30000))
            reconnectCount++
            try {
                val lesson = state.connected?.lesson ?: return@launch
                client.checkin(state.environment, lesson)
                openSocket(current)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                report(e.message ?: "重连失败")
                reconnect = null
                scheduleReconnect(current)
            }
        }
    }

    fun resync() {
        if (!state.active || state.busy) return
        val current = generation
        lessonScope.launch {
            state.busy = true; changed()
            try {
                val lesson = state.connected?.lesson ?: return@launch
                client.checkin(state.environment, lesson)
                (state.connected?.presentation?.id ?: lesson.presentationId)?.let { loadPresentation(it) }
                reconnect?.cancel(); reconnect = null
                openSocket(current)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { report(e.message ?: "同步失败"); scheduleReconnect(current) }
            finally { if (current == generation) { state.busy = false; changed() } }
        }
    }

    private suspend fun loadPresentation(id: String) {
        val connected = state.connected ?: return
        mergePresentation(client.fetchPresentation(state.environment, connected.lesson.id, id))
    }

    private fun mergePresentation(presentation: Presentation) {
        val connected = state.connected ?: return
        if (presentation.lessonId != connected.lesson.id) return
        val previous = connected.problems.associateBy { it.id }
        val problems = presentation.slides.mapNotNull { slide -> slide.problem?.also { p ->
            previous[p.id]?.let { old -> p.unlockedAt = old.unlockedAt; p.deadlineAt = old.deadlineAt; p.answered = p.answered || old.answered }
            when (ledger.getString(ledgerKey(p), null)) {
                "submitted" -> p.answered = true
                "pending" -> state.question(p).submissionUnknown = true
            }
        } }
        // Retain earlier courseware and its questions when the teacher publishes another deck.
        val oldSlides = connected.presentation?.slides.orEmpty().filter { old -> presentation.slides.none { it.id == old.id } }
        val merged = presentation.copy(slides = oldSlides + presentation.slides)
        state.connected = connected.copy(presentation = merged, problems = previous.values.filter { old -> problems.none { it.id == old.id } } + problems)
        state.selectedProblem = state.selectedProblem?.let { selected -> state.connected?.problems?.find { it.id == selected.id } }
            ?: state.connected?.problems?.firstOrNull()
        pending.values.toList().forEach { applyUnlock(it) }
        changed()
    }

    fun observeBrowser(value: JSONObject) {
        if (!state.active || value.optString("lessonId") != state.connected?.lesson?.id) return
        when (value.optString("kind")) {
            "event" -> value.optJSONObject("data")?.let { messages.trySend(it.toString()) }
            "presentation" -> messages.trySend(JSONObject().put("op", "mobilepresentation")
                .put("id", value.optString("id")).put("data", value.optJSONObject("data")).toString())
        }
    }

    private suspend fun handleMessage(text: String) {
        val message = JSONObject(text)
        if (message.optString("op") == "mobilepresentation") {
            val data = message.optJSONObject("data") ?: return
            val presentation = YuketangParser.presentation(data.toString(), state.connected?.lesson?.id ?: return, message.optString("id"))
            if (presentation.id.isNotBlank()) mergePresentation(presentation)
            return
        }
        when (message.optString("op")) {
            "lessonfinished" -> { disconnect(); report("课堂已结束，已停止自动回答"); return }
            "problemanswered" -> {
                val id = listOf("problemId", "problem_id", "problemid", "id").firstNotNullOfOrNull { message.opt(it)?.toString() }
                state.connected?.problems?.find { it.id == id }?.let {
                    it.answered = true; state.question(it).submissionUnknown = false
                    ledger.edit().putString(ledgerKey(it), "submitted").commit()
                    state.question(it).status = "已同步服务端作答状态"
                }
            }
            "closeproblem", "lockproblem" -> {
                val id = message.optJSONObject("problem")?.optString("problemId") ?: message.optString("problemId", message.optString("prob"))
                state.connected?.problems?.find { it.id == id }?.deadlineAt = System.currentTimeMillis()
            }
        }
        val unlocks = YuketangParser.unlockEvents(text)
        for (unlock in unlocks) {
            pending[unlock.id] = unlock
            if (pending.size > 500) pending.remove(pending.keys.first())
            // Notify on the live event even if its slide/question data has not arrived yet.
            // Timeline recovery is deliberately silent.
            if (message.optString("op") == "unlockproblem") state.connected?.let { connected ->
                val answered = connected.problems.find { it.id == unlock.id }?.answered == true ||
                    ledger.getString("${state.environment.name}:${connected.lesson.id}:${unlock.id}", null) == "submitted"
                problemNotifications.show(state.environment, connected.lesson, unlock, settings.settings().notifyNewProblems, answered)
            }
            if (state.connected?.problems?.none { it.id == unlock.id } == true) {
                unlock.presentationId?.let { loadPresentation(it) }
            }
            applyUnlock(unlock)
        }
        if (unlocks.isEmpty() && message.optString("op").lowercase().contains("presentation")) {
            val entity = message.optJSONObject("presentation") ?: message
            val id = listOf("presentationId", "presentation_id", "pres", "id").firstNotNullOfOrNull { entity.opt(it)?.takeIf { v -> v is String || v is Number }?.toString() }
                ?: message.opt("presentation")?.takeIf { it is String || it is Number }?.toString()
            if (!id.isNullOrBlank()) loadPresentation(id)
        }
        changed()
    }

    private fun applyUnlock(unlock: YuketangParser.Unlock) {
        val p = state.connected?.problems?.find { it.id == unlock.id } ?: return
        pending.remove(unlock.id)
        if (p.unlockedAt?.let { it > unlock.at } == true) return
        val first = p.unlockedAt == null
        p.unlockedAt = unlock.at; p.deadlineAt = unlock.deadline
        if (!first || p.answered || !isOpen(p)) return
        selectProblem(p)
        report("收到新题目：${p.prompt.take(40).ifBlank { p.id }}")
        onNewProblem?.invoke()
        if (settings.settings().autoAnalyze || settings.settings().autoSubmit) analyze(p, automatic = true)
    }

    fun selectProblem(p: Problem) {
        state.selectedProblem = p
        state.connected?.presentation?.slides?.indexOfFirst { it.id == p.slideId }?.takeIf { it >= 0 }?.let { state.slideIndex = it }
        changed()
    }

    fun analyze(p: Problem, automatic: Boolean = false) {
        if (answerJobs[p.id]?.isActive == true) return
        val q = state.question(p)
        q.analyzing = true; q.status = "等待 AI 分析"; changed()
        answerJobs[p.id] = lessonScope.launch {
            try {
                aiSlots.withPermit {
                    if (automatic && (!state.active || !isOpen(p))) return@withPermit
                    val profile = settings.aiProfile() ?: error("请先在配置页启用 AI 服务")
                    q.status = "AI 正在分析"; changed()
                    val image = if (settings.settings().includeCurrentSlide) state.connected?.presentation?.slides?.find { it.id == p.slideId }?.imageUrl else null
                    q.answer = ai.answerProblem(profile, p, image)
                    q.draft = q.answer!!.answerText
                    q.status = "AI 答案已生成"; changed()
                    if (automatic && settings.settings().autoSubmit) {
                        if (AnswerParser.normalized(p, q.draft) == null) { q.status = "答案格式不明确，等待手动核对"; return@withPermit }
                        q.status = "3 秒后自动提交，可在课堂页暂停"; changed()
                        delay(autoSubmitDelayMs)
                        if (settings.settings().autoSubmit && state.active && isOpen(p) && state.online) submitNow(p, q.draft)
                        else q.status = "自动提交已暂停或题目已截止"
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { q.status = e.message ?: "AI 分析失败"; report(q.status) }
            finally { q.analyzing = false; changed() }
        }
    }

    fun submit(p: Problem, answer: String, forceRetry: Boolean = false) {
        if (state.question(p).submitting) return
        lessonScope.launch {
            try { submitNow(p, answer, forceRetry) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { state.question(p).status = e.message ?: "答案提交失败"; report(state.question(p).status) }
            finally { changed() }
        }
    }

    private suspend fun submitNow(requested: Problem, answer: String, forceRetry: Boolean = false) {
        val p = state.connected?.problems?.find { it.id == requested.id } ?: error("题目已不在当前课堂")
        val q = state.question(p)
        require(state.active && state.online) { "课堂未连接，请先重新连接课堂" }
        require(forceRetry || isOpen(p)) { "题目未解锁、已截止或已经作答；请核对后使用手动补答" }
        val previousSubmission = ledger.getString(ledgerKey(p), null)
        require(!q.submitting && !q.submissionUnknown && previousSubmission != "pending" && (forceRetry || previousSubmission == null)) {
            "此题已有提交记录，请先核对服务端状态"
        }
        require(AnswerParser.normalized(p, answer) != null) { "答案格式不匹配" }
        // Persist BEFORE the network write: a lost response/process restart must not duplicate an answer.
        check(ledger.edit().putString(ledgerKey(p), "pending").commit()) { "无法保存提交状态，未提交" }
        q.submitting = true; q.submissionUnknown = true; q.status = if (forceRetry) "正在补答" else "正在提交"; changed()
        try {
            client.submitAnswer(state.environment, p, answer, forceRetry)
            ledger.edit().putString(ledgerKey(p), "submitted").commit()
            q.submissionUnknown = false; q.status = if (forceRetry) "补答成功" else "已提交"; report("题目 ${p.id} ${q.status}")
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { error("${if (forceRetry) "补答" else "提交"}结果未确认，请在雨课堂网页核对后再决定是否重试") }
        finally { q.submitting = false; changed() }
    }

    fun allowManualRetry(p: Problem) {
        if (state.question(p).submitting) return
        if (p.answered) ledger.edit().putString(ledgerKey(p), "submitted").commit()
        else ledger.edit().remove(ledgerKey(p)).commit()
        state.question(p).submissionUnknown = false
        state.question(p).status = "已解除待核对状态，可手动提交"
        changed()
    }

    private fun ledgerKey(p: Problem) = "${state.environment.name}:${p.lessonId}:${p.id}"
    private fun isOpen(p: Problem) = p.unlockedAt != null && !p.answered && (p.deadlineAt?.let { it > System.currentTimeMillis() } != false)

    fun saveSettings(value: UserSettings) {
        val previous = settings.settings()
        if (value == previous) return
        settings.saveSettings(value)
        if (!value.notifyNewProblems) problemNotifications.clear()
        report(if (value.autoSubmit != previous.autoSubmit) {
            if (value.autoSubmit) "自动回答已开启：新题目将自动分析并提交" else "自动提交已关闭"
        } else "设置已自动保存")
    }

    fun ask(question: String, withSlide: Boolean) {
        if (state.chatBusy || question.isBlank()) return
        val current = generation
        val requestId = ++chatGeneration
        val slide = state.connected?.presentation?.slides?.getOrNull(state.slideIndex)
        val contextKey = if (withSlide) "slide:${slide?.id}" else "general"
        state.chatBusy = true; changed()
        chatJob = lessonScope.launch {
            try {
                val profile = settings.aiProfile() ?: error("请先在配置页启用 AI 服务")
                val response = ai.askCourseware(profile, question, if (withSlide) slide?.imageUrl else null,
                    if (withSlide) listOfNotNull(slide?.title, slide?.problem?.prompt).joinToString("\n") else "")
                if (current == generation && requestId == chatGeneration) state.courseAnswers[contextKey] = response
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (requestId == chatGeneration) state.courseAnswers[contextKey] = e.message ?: "AI 问答失败" }
            finally { if (requestId == chatGeneration) { state.chatBusy = false; changed() } }
        }
    }

    fun cancelChat() { chatGeneration++; chatJob?.cancel(); state.chatBusy = false; changed() }

    fun saveProfile(profile: AiProfile, test: Boolean) {
        profileJob?.cancel()
        state.modelStatusKind = ModelStatusKind.IDLE
        profileJob = scope.launch {
            try {
                AiClient.endpoint(profile.baseUrl, "chat/completions")
                require(profile.apiKey.isNotBlank() && profile.model.isNotBlank()) { "API Key 和模型名称不能为空" }
                settings.saveAiProfile(profile)
                state.modelStatusKind = if (test) ModelStatusKind.TESTING else ModelStatusKind.IDLE
                state.modelStatus = if (test) "配置已保存并启用，正在发送真实问答请求…" else "当前配置已保存并启用"
                changed()
                if (test) {
                    ai.test(profile)
                    if (profile.visionModel.isNotBlank() && profile.visionModel != profile.model) ai.test(profile.copy(model = profile.visionModel))
                    val draftUnchanged = settings.selectedAiProviderId() == profile.providerPresetId && settings.aiDraft(profile.providerPresetId) == profile
                    state.modelStatusKind = if (draftUnchanged) ModelStatusKind.SUCCESS else ModelStatusKind.IDLE
                    state.modelStatus = if (draftUnchanged) "文本问答连接成功；图片能力请在课件页验证"
                        else "已启用配置的测试完成；当前编辑的配置尚未测试"
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { state.modelStatusKind = ModelStatusKind.ERROR; state.modelStatus = e.message ?: "模型测试失败" }
            finally { changed() }
        }
    }

    fun clearProfile() {
        profileJob?.cancel()
        settings.clearAiProfile()
        state.modelStatusKind = ModelStatusKind.IDLE
        state.modelStatus = "模型配置已清除"
        changed()
    }

    fun disconnect(notify: Boolean = true) {
        problemNotifications.clear()
        generation++; chatGeneration++
        sessionJob.cancel(); client.close(); reconnect = null; reconnectCount = 0
        sessionJob = SupervisorJob(scope.coroutineContext[Job]); lessonScope = CoroutineScope(sessionJob + Dispatchers.Main.immediate)
        messages.close(); messages = Channel(Channel.UNLIMITED)
        pending.clear(); answerJobs.clear()
        state.active = false; state.online = false; state.busy = false; state.chatBusy = false
        state.questions.values.forEach { it.analyzing = false; it.submitting = false }
        if (notify) { report("已断开课堂，自动回答已停止"); onSessionEnded?.invoke() }
    }
}
