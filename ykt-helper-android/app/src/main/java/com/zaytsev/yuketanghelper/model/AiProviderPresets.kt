package com.zaytsev.yuketanghelper.model

/** Provider choices match the desktop app. Defaults are editable starting points. */
data class AiProviderPreset(val id: String, val label: String, val baseUrl: String, val model: String) {
    fun profile() = AiProfile(baseUrl, "", model, model, id)
}

object AiProviderPresets {
    const val defaultId = "deepseek"
    val all = listOf(
        AiProviderPreset("moonshot", "Moonshot AI（Kimi）", "https://api.moonshot.cn/v1", "kimi-k3.1-pro"),
        AiProviderPreset("deepseek", "DeepSeek", "https://api.deepseek.com", "deepseek-flash"),
        AiProviderPreset("openai", "OpenAI", "https://api.openai.com/v1", "gpt-5-mini"),
        AiProviderPreset("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openai/gpt-5-mini"),
        AiProviderPreset("custom", "自定义（手动输入）", "", ""),
    )
    fun find(id: String) = all.firstOrNull { it.id == id } ?: all.last()
    fun infer(baseUrl: String): String {
        val normalized = baseUrl.trim().trimEnd('/').removeSuffix("/chat/completions").removeSuffix("/v1")
        return all.firstOrNull { it.baseUrl.isNotBlank() && it.baseUrl.removeSuffix("/v1") == normalized }?.id ?: "custom"
    }
}
