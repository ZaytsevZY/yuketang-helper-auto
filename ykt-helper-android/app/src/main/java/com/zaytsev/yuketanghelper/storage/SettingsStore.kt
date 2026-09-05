package com.zaytsev.yuketanghelper.storage

import android.content.Context
import com.zaytsev.yuketanghelper.model.AiProfile
import com.zaytsev.yuketanghelper.model.UserSettings
import com.zaytsev.yuketanghelper.security.SecureVault

class SettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val vault = SecureVault(context)

    fun settings(): UserSettings = UserSettings(
        autoAnalyze = preferences.getBoolean("auto_analyze", true),
        autoExpandOnProblem = preferences.getBoolean("auto_expand", true),
        includeCurrentSlide = preferences.getBoolean("include_slide", true),
    )

    fun saveSettings(value: UserSettings) {
        preferences.edit()
            .putBoolean("auto_analyze", value.autoAnalyze)
            .putBoolean("auto_expand", value.autoExpandOnProblem)
            .putBoolean("include_slide", value.includeCurrentSlide)
            .apply()
    }

    fun aiProfile(): AiProfile? {
        val baseUrl = preferences.getString("ai_base_url", "")?.trim().orEmpty()
        val model = preferences.getString("ai_model", "")?.trim().orEmpty()
        val visionModel = preferences.getString("ai_vision_model", model)?.trim().orEmpty()
        val apiKey = vault.get("ai_api_key").orEmpty()
        if (baseUrl.isBlank() || model.isBlank() || apiKey.isBlank()) return null
        return AiProfile(baseUrl, apiKey, model, visionModel.ifBlank { model })
    }

    fun saveAiProfile(profile: AiProfile) {
        preferences.edit()
            .putString("ai_base_url", profile.baseUrl.trim())
            .putString("ai_model", profile.model.trim())
            .putString("ai_vision_model", profile.visionModel.trim())
            .apply()
        vault.put("ai_api_key", profile.apiKey.trim())
    }

    fun bearerToken(environmentName: String): String? = vault.get("bearer_$environmentName")

    fun saveBearerToken(environmentName: String, token: String?) {
        vault.put("bearer_$environmentName", token)
    }
}
