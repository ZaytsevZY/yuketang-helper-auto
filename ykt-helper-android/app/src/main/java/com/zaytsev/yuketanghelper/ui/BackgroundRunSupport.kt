package com.zaytsev.yuketanghelper.ui

import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** Public settings entry points only; manufacturers may expose additional controls inside them. */
object BackgroundRunSupport {
    fun status(context: Context): String {
        val power = context.getSystemService(PowerManager::class.java)
        val exemption = runCatching { power.isIgnoringBatteryOptimizations(context.packageName) }.getOrNull()
        val restricted = if (Build.VERSION.SDK_INT >= 28) runCatching {
            context.getSystemService(ActivityManager::class.java).isBackgroundRestricted
        }.getOrNull() else null
        return listOfNotNull(
            when (exemption) {
                true -> "系统电池优化：已豁免"
                false -> "系统电池优化：未豁免"
                null -> "系统电池优化：暂时无法读取"
            },
            restricted?.let { if (it) "系统检测到后台活动受限" else "系统未报告后台活动受限" },
            if (power.isPowerSaveMode) "省电模式：已开启，可能影响后台收题" else "省电模式：未开启",
        ).joinToString("\n")
    }

    fun open(context: Context, batteryOptimization: Boolean): Boolean {
        val options = buildList {
            if (batteryOptimization) add(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
            add(Intent(Settings.ACTION_SETTINGS))
        }
        for (intent in options) {
            try {
                context.startActivity(intent)
                return true
            } catch (_: ActivityNotFoundException) {
                // Some OEM settings apps omit a standard screen. Try the broader entry point.
            } catch (_: SecurityException) {
                // A vendor may expose the activity but restrict callers.
            }
        }
        return false
    }
}
