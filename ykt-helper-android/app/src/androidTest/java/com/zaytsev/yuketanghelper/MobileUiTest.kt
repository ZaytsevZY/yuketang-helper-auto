package com.zaytsev.yuketanghelper

import android.content.Intent
import android.content.pm.ActivityInfo
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Spinner
import android.widget.Button
import android.widget.TextView
import com.zaytsev.yuketanghelper.model.AiProviderPresets
import androidx.core.content.ContextCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zaytsev.yuketanghelper.model.ConnectedLesson
import com.zaytsev.yuketanghelper.model.Lesson
import com.zaytsev.yuketanghelper.session.ClassroomService
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileUiTest {
    @Test fun eachProviderDraftPersistsWithoutOverwritingEnabledProfile() {
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        val store = com.zaytsev.yuketanghelper.storage.SettingsStore(context)
        store.clearAiProfile()
        try {
            val profiles = AiProviderPresets.all.map { it.profile().copy(baseUrl = "https://${it.id}.example/v1", apiKey = "fake-${it.id}-key", model = "${it.id}-text", visionModel = "${it.id}-vision") }
            store.saveAiProfile(profiles[1])
            profiles.forEach(store::saveAiDraft)
            store.selectAiProvider("openrouter")
            val restored = com.zaytsev.yuketanghelper.storage.SettingsStore(context)
            profiles.forEach { assertEquals(it, restored.aiDraft(it.providerPresetId)) }
            assertEquals("openrouter", restored.selectedAiProviderId())
            assertEquals(profiles[1], restored.aiProfile())
            restored.saveAiDraft(profiles[1].copy(apiKey = "", model = ""))
            assertEquals("", com.zaytsev.yuketanghelper.storage.SettingsStore(context).aiDraft("deepseek").apiKey)
            assertEquals(profiles[1], restored.aiProfile())
            val ciphertexts = context.getSharedPreferences("secure_credentials", android.content.Context.MODE_PRIVATE).all.values.joinToString()
            profiles.forEach { assertFalse(ciphertexts.contains(it.apiKey)) }
            restored.clearAiProfile()
            AiProviderPresets.all.forEach { assertEquals(it.profile(), restored.aiDraft(it.id)) }
        } finally { store.clearAiProfile() }
    }
    @Test fun legacySingleProfileMigratesWithoutOverwritingNewDrafts() {
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        val store = com.zaytsev.yuketanghelper.storage.SettingsStore(context)
        store.clearAiProfile()
        val prefs = context.getSharedPreferences("settings", android.content.Context.MODE_PRIVATE)
        try {
            val legacy = AiProviderPresets.find("deepseek").profile().copy(baseUrl = "https://edited.example/v1", apiKey = "fake-old-key", model = "old-model")
            prefs.edit().putString("ai_provider_preset", "deepseek").putString("ai_base_url", legacy.baseUrl)
                .putString("ai_model", legacy.model).putString("ai_vision_model", legacy.visionModel).commit()
            com.zaytsev.yuketanghelper.security.SecureVault(context).put("ai_api_key", legacy.apiKey)
            val migrated = com.zaytsev.yuketanghelper.storage.SettingsStore(context)
            assertEquals(legacy, migrated.aiProfile())
            assertEquals(legacy, migrated.aiDraft("deepseek"))
            assertEquals("deepseek", migrated.selectedAiProviderId())
            assertFalse(prefs.contains("ai_base_url"))
            assertFalse(context.getSharedPreferences("secure_credentials", android.content.Context.MODE_PRIVATE).contains("ai_api_key"))
            val updated = legacy.copy(apiKey = "fake-new-key", model = "new-model")
            migrated.saveAiDraft(updated)
            assertEquals(updated, com.zaytsev.yuketanghelper.storage.SettingsStore(context).aiDraft("deepseek"))
        } finally { store.clearAiProfile() }
    }
    @Test fun aboutPageContainsStaticInformationAndReturnsToSettings() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals("配置", activity.findViewById<TextView>(R.id.tabModels).text.toString())
                activity.findViewById<View>(R.id.tabSettings).performClick()
                val settingViews = descendants(activity.findViewById(R.id.assistantContent))
                assertFalse(settingViews.filterIsInstance<TextView>().any { it.text == "版本信息" })
                settingViews.filterIsInstance<Button>().first { it.text == "关于" }.performClick()
                val labels = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<TextView>().map { it.text.toString() }
                assertTrue(labels.contains("版本信息"))
                assertFalse(labels.contains("雨课堂服务器"))
                assertTrue(labels.contains("雨课堂助手-安卓-v${BuildConfig.VERSION_NAME}"))
                assertTrue(labels.contains("版权所有，侵权必究。\n开源许可：MIT"))
                assertTrue(labels.contains("请按照学校、课堂和老师的相关规定使用本应用，不得用于课堂或考试作弊。"))
                activity.onBackPressedDispatcher.onBackPressed()
                assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.assistantSheet).visibility)
                assertNotNull(activity.findViewById<ViewGroup>(R.id.assistantContent).findViewWithTag<Spinner>("classroomEnvironment"))
            }
        }
    }
    @Test fun savedKeyIsEncryptedRestoredAndCanBeCleared() {
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        val store = com.zaytsev.yuketanghelper.storage.SettingsStore(context)
        val previous = store.aiProfile()
        try {
            val profile = com.zaytsev.yuketanghelper.model.AiProfile("https://api.deepseek.com", "fake-persistence-key", "deepseek-flash", providerPresetId = "deepseek")
            store.saveAiProfile(profile)
            val stored = context.getSharedPreferences("secure_credentials", android.content.Context.MODE_PRIVATE).getString("ai_active_profile", null)
            assertNotNull(stored)
            assertFalse(stored!!.contains(profile.apiKey))
            assertEquals(profile, com.zaytsev.yuketanghelper.storage.SettingsStore(context).aiProfile())
            store.clearAiProfile()
            assertNull(com.zaytsev.yuketanghelper.storage.SettingsStore(context).aiProfile())
            assertFalse(context.getSharedPreferences("secure_credentials", android.content.Context.MODE_PRIVATE).contains("ai_active_profile"))
        } finally {
            if (previous != null) store.saveAiProfile(previous) else store.clearAiProfile()
        }
    }
    @Test fun expiredQuestionOffersManualRetryAndCancelDoesNotSubmit() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            try {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    val p = com.zaytsev.yuketanghelper.model.Problem("ui-retry", "ui-lesson", "p", "s",
                        com.zaytsev.yuketanghelper.model.ProblemType.SINGLE_CHOICE, "模拟补答题目", listOf("甲", "乙"), 1, 2)
                    session.state.connected = ConnectedLesson(Lesson("ui-lesson", "模拟课堂", "active", null, null), null, listOf(p))
                    session.state.active = true; session.state.online = true
                    session.state.selectedProblem = p
                    session.state.question(p).draft = "B"
                    activity.findViewById<View>(R.id.tabProblems).performClick()
                    val retry = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<Button>().first { it.text == "补答本题（已截止）" }
                    assertTrue(retry.isEnabled)
                    retry.performClick()
                }
                androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("确认补答本题？"))
                    .inRoot(androidx.test.espresso.matcher.RootMatchers.isDialog())
                    .check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()))
                androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("取消"))
                    .inRoot(androidx.test.espresso.matcher.RootMatchers.isDialog())
                    .perform(androidx.test.espresso.action.ViewActions.click())
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    val p = session.state.selectedProblem!!
                    assertFalse(session.state.question(p).submitting)
                    assertFalse(session.state.question(p).submissionUnknown)
                    p.answered = true
                    session.changed()
                    assertTrue(descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<Button>().any { it.text == "修改答案并补答" && it.isEnabled })
                }
            } finally {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    session.disconnect(); session.state.connected = null; session.state.selectedProblem = null; session.state.questions.clear()
                }
            }
        }
    }
    @Test fun modelStatusUpdatesWhileEditingWithoutLosingDraft() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.findViewById<View>(R.id.tabModels).performClick()
                val container = activity.findViewById<ViewGroup>(R.id.assistantContent)
                val field = descendants(container).filterIsInstance<EditText>()[2]
                field.requestFocus(); field.setText("draft-kept")
                val session = (activity.application as HelperApplication).session
                session.state.modelStatusKind = com.zaytsev.yuketanghelper.ui.ModelStatusKind.SUCCESS
                session.state.modelStatus = "文本问答连接成功；图片能力请在课件页验证"
                session.changed()
                val status = container.findViewWithTag<TextView>("modelConnectionStatus")
                assertEquals(session.state.modelStatus, status.text.toString())
                assertEquals(android.graphics.Color.rgb(20, 125, 64), status.currentTextColor)
                assertNotNull(status.compoundDrawablesRelative[0])
                assertEquals("draft-kept", field.text.toString())
                assertTrue(field.hasFocus())
                session.state.modelStatusKind = com.zaytsev.yuketanghelper.ui.ModelStatusKind.ERROR
                session.state.modelStatus = "AI 鉴权失败"
                session.changed()
                assertEquals("AI 鉴权失败", status.text.toString())
                assertEquals(android.graphics.Color.rgb(176, 37, 37), status.currentTextColor)
                session.state.modelStatusKind = com.zaytsev.yuketanghelper.ui.ModelStatusKind.IDLE
            }
        }
    }
    @Test fun configurationBadgePersistsUntilProfileEnabledAndReturnsWhenCleared() {
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            try {
                scenario.onActivity { activity ->
                    activity.clearProfile()
                    val tabs = activity.findViewById<com.zaytsev.yuketanghelper.ui.GlassTabBar>(R.id.assistantTabs)
                    assertTrue(tabs.hasBadge(R.id.tabModels))
                    assertTrue(activity.findViewById<View>(R.id.tabModels).contentDescription.toString().contains("API Key"))
                    val edits = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                    edits[0].setText("https://api.deepseek.com")
                    edits[1].setText("fake-badge-key")
                    edits[2].setText("deepseek-flash")
                    assertTrue(tabs.hasBadge(R.id.tabModels))
                    descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<Button>()
                        .first { it.text == "启用当前配置" }.performClick()
                }
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    assertFalse(activity.findViewById<com.zaytsev.yuketanghelper.ui.GlassTabBar>(R.id.assistantTabs).hasBadge(R.id.tabModels))
                    assertEquals("配置", activity.findViewById<View>(R.id.tabModels).contentDescription)
                }
                scenario.recreate()
                scenario.onActivity { activity ->
                    val tabs = activity.findViewById<com.zaytsev.yuketanghelper.ui.GlassTabBar>(R.id.assistantTabs)
                    assertFalse(tabs.hasBadge(R.id.tabModels))
                    activity.clearProfile()
                    assertTrue(tabs.hasBadge(R.id.tabModels))
                }
            } finally { scenario.onActivity { it.clearProfile() } }
        }
    }

    @Test fun backgroundRunGuideOpensStandardSettingsAndReturnsToSettingsPage() {
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val battery = instrumentation.addMonitor(android.content.IntentFilter(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED, null), true)
        val details = instrumentation.addMonitor(android.content.IntentFilter(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply { addDataScheme("package") },
            android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED, null), true)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { activity ->
                    activity.findViewById<View>(R.id.tabSettings).performClick()
                    descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<Button>()
                        .first { it.text == "后台运行设置" }.performClick()
                    val body = activity.findViewById<ViewGroup>(R.id.assistantContent)
                    assertEquals(com.zaytsev.yuketanghelper.ui.BackgroundRunSupport.status(activity), body.findViewWithTag<TextView>("backgroundSystemStatus").text.toString())
                    descendants(body).filterIsInstance<Button>().first { it.text == "打开电池优化设置" }.performClick()
                    descendants(body).filterIsInstance<Button>().first { it.text == "打开应用系统设置" }.performClick()
                }
                instrumentation.waitForIdleSync()
                assertEquals(1, battery.hits)
                assertEquals(1, details.hits)
                scenario.onActivity { activity ->
                    assertTrue(activity.findViewById<com.google.android.material.button.MaterialButton>(R.id.tabSettings).isChecked)
                    activity.onBackPressedDispatcher.onBackPressed()
                    assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.assistantSheet).visibility)
                    assertTrue(descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<Button>().any { it.text == "后台运行设置" })
                }
            }
        } finally { instrumentation.removeMonitor(battery); instrumentation.removeMonitor(details) }
    }

    @Test fun everySettingsSwitchSavesImmediatelyWithoutResettingScrollOrOtherOptions() {
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        var expected = com.zaytsev.yuketanghelper.model.UserSettings()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            try {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    session.disconnect()
                    session.saveSettings(expected)
                    activity.findViewById<View>(R.id.tabSettings).performClick()
                }
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    val body = activity.findViewById<ViewGroup>(R.id.assistantContent)
                    val scroll = body.getChildAt(0) as androidx.core.widget.NestedScrollView
                    scroll.scrollTo(0, 300)
                    val position = scroll.scrollY
                    assertTrue(position > 0)
                    for (key in listOf("notifyNewProblems", "autoAnalyze", "autoSubmit", "autoExpandOnProblem", "includeCurrentSlide", "keepScreenOn")) {
                        val toggle = body.findViewWithTag<com.google.android.material.materialswitch.MaterialSwitch>(key)
                        val selected = !toggle.isChecked
                        expected = when (key) {
                            "notifyNewProblems" -> expected.copy(notifyNewProblems = selected)
                            "autoAnalyze" -> expected.copy(autoAnalyze = selected)
                            "autoSubmit" -> expected.copy(autoSubmit = selected)
                            "autoExpandOnProblem" -> expected.copy(autoExpandOnProblem = selected)
                            "includeCurrentSlide" -> expected.copy(includeCurrentSlide = selected)
                            else -> expected.copy(keepScreenOn = selected)
                        }
                        toggle.performClick()
                        assertEquals(expected, com.zaytsev.yuketanghelper.storage.SettingsStore(activity).settings())
                        assertSame(scroll, body.getChildAt(0))
                        assertEquals(position, scroll.scrollY)
                    }
                    // A service-side pause must update the existing switch without saving stale UI values.
                    expected = expected.copy(autoSubmit = false)
                    session.saveSettings(expected)
                    assertFalse(body.findViewWithTag<com.google.android.material.materialswitch.MaterialSwitch>("autoSubmit").isChecked)
                    assertEquals(expected, session.settings.settings())
                    assertSame(scroll, body.getChildAt(0))
                    assertEquals(position, scroll.scrollY)
                }
                scenario.recreate()
                scenario.onActivity { activity ->
                    assertEquals(expected, com.zaytsev.yuketanghelper.storage.SettingsStore(activity).settings())
                    activity.findViewById<View>(R.id.tabSettings).performClick()
                    assertTrue(activity.findViewById<ViewGroup>(R.id.assistantContent)
                        .findViewWithTag<com.google.android.material.materialswitch.MaterialSwitch>("keepScreenOn").isChecked)
                }
            } finally {
                scenario.onActivity { activity ->
                    (activity.application as HelperApplication).session.saveSettings(com.zaytsev.yuketanghelper.model.UserSettings())
                }
            }
        }
    }

    @Test fun problemReminderSwitchDefaultsOnAndSavesAcrossRecreation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            try {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    activity.getSharedPreferences("settings", android.content.Context.MODE_PRIVATE).edit().remove("notify_new_problems").commit()
                    assertTrue(session.settings.settings().notifyNewProblems)
                    activity.findViewById<View>(R.id.tabSettings).performClick()
                    val body = activity.findViewById<ViewGroup>(R.id.assistantContent)
                    val toggle = body.findViewWithTag<com.google.android.material.materialswitch.MaterialSwitch>("notifyNewProblems")
                    assertTrue(toggle.isChecked)
                    toggle.performClick()
                    assertFalse(descendants(body).filterIsInstance<Button>().any { it.text == "保存设置" })
                    assertFalse(com.zaytsev.yuketanghelper.storage.SettingsStore(activity).settings().notifyNewProblems)
                }
                scenario.recreate()
                scenario.onActivity { activity ->
                    activity.findViewById<View>(R.id.tabSettings).performClick()
                    assertFalse(activity.findViewById<ViewGroup>(R.id.assistantContent)
                        .findViewWithTag<com.google.android.material.materialswitch.MaterialSwitch>("notifyNewProblems").isChecked)
                }
            } finally {
                scenario.onActivity { activity ->
                    val session = (activity.application as HelperApplication).session
                    session.saveSettings(session.settings.settings().copy(notifyNewProblems = true))
                }
            }
        }
    }
    @Test fun toolbarTogglesAssistantAndKeepsSelectedPage() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val title = activity.findViewById<TextView>(R.id.appTitle)
                assertEquals("雨课堂助手\n安卓-v${BuildConfig.VERSION_NAME}", title.text.toString())
                assertEquals("雨课堂助手-安卓-v${BuildConfig.VERSION_NAME}", title.contentDescription.toString())
                activity.findViewById<View>(R.id.tabModels).performClick()
                val sheet = activity.findViewById<View>(R.id.assistantSheet)
                val toggle = activity.findViewById<Button>(R.id.settingsButton)
                assertEquals(View.VISIBLE, sheet.visibility)
                assertEquals("收起助手", toggle.text.toString())
                toggle.performClick()
                assertEquals(View.GONE, sheet.visibility)
                assertEquals(activity.getString(R.string.open_assistant), toggle.contentDescription)
                assertEquals("打开助手", toggle.text.toString())
                toggle.performClick()
                assertEquals(View.VISIBLE, sheet.visibility)
                assertTrue(activity.findViewById<com.google.android.material.button.MaterialButton>(R.id.tabModels).isChecked)
                assertEquals(4, descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>().size)
                assertEquals(activity.getString(R.string.close_assistant), toggle.contentDescription)
                assertEquals("收起助手", toggle.text.toString())
            }
        }
    }
    @Test fun modelDraftSurvivesSessionUpdatesAndRotation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                activity.findViewById<View>(R.id.tabModels).performClick()
                val edits = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                assertEquals(4, edits.size)
                val model = edits[2]
                model.requestFocus(); model.setText("draft-model")
                (activity.application as HelperApplication).session.report("模拟后台连接状态更新")
                assertEquals("draft-model", model.text.toString())
                assertNotNull(model.parent)
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }
            scenario.onActivity { activity ->
                val edits = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                assertEquals("draft-model", edits[2].text.toString())
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
    }
    @Test fun foregroundSessionCanBePausedAndStoppedFromServiceActions() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val session = (activity.application as HelperApplication).session
                session.state.connected = ConnectedLesson(Lesson("test", "模拟后台课堂", "active", null, null), null, emptyList())
                session.state.active = true
                session.saveSettings(session.settings.settings().copy(autoSubmit = true))
                ContextCompat.startForegroundService(activity, Intent(activity, ClassroomService::class.java))
            }
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            scenario.onActivity { activity -> activity.startService(Intent(activity, ClassroomService::class.java).setAction("pause")) }
            awaitActivityCondition(scenario) { !(it.application as HelperApplication).session.settings.settings().autoSubmit }
            scenario.onActivity { activity ->
                assertFalse((activity.application as HelperApplication).session.settings.settings().autoSubmit)
                activity.startService(Intent(activity, ClassroomService::class.java).setAction("stop"))
            }
            awaitActivityCondition(scenario) { !(it.application as HelperApplication).session.state.active }
            scenario.onActivity { activity -> assertFalse((activity.application as HelperApplication).session.state.active) }
        }
    }
    @Test fun providerSelectionFillsEditableFieldsAndKeepsSeparateDrafts() {
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as HelperApplication
        app.session.settings.clearAiProfile()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { it.findViewById<View>(R.id.tabModels).performClick() }
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    val index = activity.findViewById<ViewGroup>(R.id.assistantContent).findViewWithTag<Spinner>("aiProvider").selectedItemPosition
                    assertEquals("deepseek", AiProviderPresets.all[index].id)
                    val fields = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                    assertEquals("https://api.deepseek.com", fields[0].text.toString())
                    assertEquals("deepseek-flash", fields[2].text.toString())
                }
                for ((index, preset) in AiProviderPresets.all.withIndex()) {
                    scenario.onActivity { it.findViewById<ViewGroup>(R.id.assistantContent).findViewWithTag<Spinner>("aiProvider").setSelection(index) }
                    instrumentation.waitForIdleSync()
                    scenario.onActivity { activity ->
                        val fields = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                        assertEquals(preset.baseUrl, fields[0].text.toString())
                        assertEquals(preset.model, fields[2].text.toString())
                        assertTrue(fields.all { it.isEnabled && it.keyListener != null })
                        assertEquals("", fields[1].text.toString())
                        fields[1].setText("fake-key-${preset.id}")
                    }
                }
                scenario.onActivity { activity ->
                    val fields = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                    fields[0].setText("https://custom.example/v1")
                    fields[2].setText("custom-text")
                    fields[3].setText("")
                    activity.findViewById<ViewGroup>(R.id.assistantContent).findViewWithTag<Spinner>("aiProvider").setSelection(0)
                }
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    val fields = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                    assertEquals("fake-key-moonshot", fields[1].text.toString())
                    // Editing a preset URL/model must survive a page refresh and later selection.
                    fields[0].setText("https://edited.example/v1")
                    fields[2].setText("edited-model")
                    activity.findViewById<ViewGroup>(R.id.assistantContent).findViewWithTag<Spinner>("aiProvider").setSelection(4)
                }
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    val fields = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                    assertEquals("https://custom.example/v1", fields[0].text.toString())
                    assertEquals("custom-text", fields[2].text.toString())
                    assertEquals("fake-key-custom", fields[1].text.toString())
                    descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<Button>().first { it.text == "启用当前配置" }.performClick()
                }
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    assertEquals("custom", app.session.settings.aiProfile()!!.providerPresetId)
                    assertEquals("custom-text", app.session.settings.aiProfile()!!.visionModel)
                    assertEquals("fake-key-custom", com.zaytsev.yuketanghelper.storage.SettingsStore(activity).aiProfile()!!.apiKey)
                    assertEquals("当前配置已保存并启用", app.session.state.modelStatus)
                    activity.findViewById<ViewGroup>(R.id.assistantContent).findViewWithTag<Spinner>("aiProvider").setSelection(0)
                }
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    val fields = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                    assertEquals("https://edited.example/v1", fields[0].text.toString())
                    assertEquals("edited-model", fields[2].text.toString())
                }
            }
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { it.findViewById<View>(R.id.tabModels).performClick() }
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    assertEquals(0, activity.findViewById<ViewGroup>(R.id.assistantContent).findViewWithTag<Spinner>("aiProvider").selectedItemPosition)
                    val fields = descendants(activity.findViewById(R.id.assistantContent)).filterIsInstance<EditText>()
                    assertEquals("https://edited.example/v1", fields[0].text.toString())
                    assertEquals("fake-key-moonshot", fields[1].text.toString())
                    assertEquals("edited-model", fields[2].text.toString())
                    assertEquals("custom", app.session.settings.aiProfile()!!.providerPresetId)
                    assertEquals("custom-text", app.session.settings.aiDraft("custom").model)
                }
            }
        } finally { app.session.settings.clearAiProfile() }
    }

    // Service actions are delivered through system IPC, which main-loop idle does not await.
    private fun awaitActivityCondition(scenario: ActivityScenario<MainActivity>, condition: (MainActivity) -> Boolean) {
        val deadline = android.os.SystemClock.uptimeMillis() + 5_000
        do {
            var ready = false
            scenario.onActivity { ready = condition(it) }
            if (ready) return
            android.os.SystemClock.sleep(50)
        } while (android.os.SystemClock.uptimeMillis() < deadline)
        fail("Service action did not update session within 5 seconds")
    }

    private fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
}
