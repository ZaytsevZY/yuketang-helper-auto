package com.zaytsev.yuketanghelper.storage

import android.content.Context
import com.zaytsev.yuketanghelper.model.AiProfile
import com.zaytsev.yuketanghelper.model.AiProviderPresets
import com.zaytsev.yuketanghelper.model.UserSettings
import com.zaytsev.yuketanghelper.security.SecureVault
import org.json.JSONObject

class SettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val vault = SecureVault(context)

    init { migrateLegacyProfile() }

    fun settings(): UserSettings = UserSettings(
        autoAnalyze = preferences.getBoolean("auto_analyze", true),
        autoExpandOnProblem = preferences.getBoolean("auto_expand", true),
        includeCurrentSlide = preferences.getBoolean("include_slide", true),
        autoSubmit = preferences.getBoolean("auto_submit", false),
        keepScreenOn = preferences.getBoolean("keep_screen_on", false),
        notifyNewProblems = preferences.getBoolean("notify_new_problems", true),
    )

    fun saveSettings(value: UserSettings) {
        preferences.edit()
            .putBoolean("auto_analyze", value.autoAnalyze)
            .putBoolean("auto_expand", value.autoExpandOnProblem)
            .putBoolean("include_slide", value.includeCurrentSlide)
            .putBoolean("auto_submit", value.autoSubmit)
            .putBoolean("keep_screen_on", value.keepScreenOn)
            .putBoolean("notify_new_problems", value.notifyNewProblems)
            .apply()
    }

    /** The enabled snapshot is separate from auto-saved edits, including incomplete drafts. */
    fun aiProfile(): AiProfile? = readProfile("ai_active_profile")?.let { profile ->
        if (profile.baseUrl.isBlank() || profile.model.isBlank() || profile.apiKey.isBlank()) null
        else profile.copy(visionModel = profile.visionModel.ifBlank { profile.model })
    }

    fun selectedAiProviderId(): String = AiProviderPresets.find(
        preferences.getString("ai_selected_provider", AiProviderPresets.defaultId)!!).id

    fun selectAiProvider(id: String) {
        preferences.edit().putString("ai_selected_provider", AiProviderPresets.find(id).id).apply()
    }

    fun aiDraft(id: String): AiProfile = readProfile("ai_profile_${AiProviderPresets.find(id).id}")
        ?: AiProviderPresets.find(id).profile()

    fun saveAiDraft(profile: AiProfile) {
        require(AiProviderPresets.all.any { it.id == profile.providerPresetId }) { "未知服务商" }
        vault.put("ai_profile_${profile.providerPresetId}", encode(profile))
    }

    fun saveAiProfile(profile: AiProfile) {
        saveAiDraft(profile)
        vault.put("ai_active_profile", encode(profile))
        selectAiProvider(profile.providerPresetId)
    }

    private fun encode(profile: AiProfile): String = JSONObject()
        .put("provider", profile.providerPresetId).put("baseUrl", profile.baseUrl)
        .put("apiKey", profile.apiKey).put("model", profile.model).put("visionModel", profile.visionModel).toString()

    private fun readProfile(key: String): AiProfile? = vault.get(key)?.let { value ->
        runCatching {
            val json = JSONObject(value)
            AiProfile(json.getString("baseUrl"), json.getString("apiKey"), json.getString("model"),
                json.getString("visionModel"), json.getString("provider"))
        }.getOrNull()
    }

    /** Upgrade 0.2.1 and earlier without overwriting any newer provider draft. */
    private fun migrateLegacyProfile() {
        if (!preferences.contains("ai_base_url") && !preferences.contains("ai_model")) return
        val baseUrl = preferences.getString("ai_base_url", "").orEmpty()
        val model = preferences.getString("ai_model", "").orEmpty()
        val id = AiProviderPresets.find(preferences.getString("ai_provider_preset", null) ?: AiProviderPresets.infer(baseUrl)).id
        val profile = AiProfile(baseUrl, vault.get("ai_api_key").orEmpty(), model,
            preferences.getString("ai_vision_model", model).orEmpty(), id)
        if (readProfile("ai_profile_$id") == null) saveAiDraft(profile)
        if (readProfile("ai_active_profile") == null) vault.put("ai_active_profile", encode(profile))
        if (!preferences.contains("ai_selected_provider")) selectAiProvider(id)
        preferences.edit().remove("ai_provider_preset").remove("ai_base_url").remove("ai_model").remove("ai_vision_model").apply()
        vault.put("ai_api_key", null)
    }

    fun environment(): com.zaytsev.yuketanghelper.model.Environment = runCatching {
        com.zaytsev.yuketanghelper.model.Environment.valueOf(preferences.getString("environment", "STANDARD")!!)
    }.getOrDefault(com.zaytsev.yuketanghelper.model.Environment.STANDARD)

    fun saveEnvironment(value: com.zaytsev.yuketanghelper.model.Environment) {
        preferences.edit().putString("environment", value.name).apply()
    }

    fun clearAiProfile() {
        AiProviderPresets.all.forEach { vault.put("ai_profile_${it.id}", null) }
        vault.put("ai_active_profile", null)
        vault.put("ai_api_key", null)
        preferences.edit().remove("ai_selected_provider").remove("ai_provider_preset")
            .remove("ai_base_url").remove("ai_model").remove("ai_vision_model").apply()
    }

    fun bearerToken(environmentName: String): String? = vault.get("bearer_$environmentName")

    fun saveBearerToken(environmentName: String, token: String?) {
        vault.put("bearer_$environmentName", token)
    }
}
