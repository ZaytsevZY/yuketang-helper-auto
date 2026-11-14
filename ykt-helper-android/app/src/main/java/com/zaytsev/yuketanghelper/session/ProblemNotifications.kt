package com.zaytsev.yuketanghelper.session

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.zaytsev.yuketanghelper.MainActivity
import com.zaytsev.yuketanghelper.R
import com.zaytsev.yuketanghelper.model.Environment
import com.zaytsev.yuketanghelper.model.Lesson
import com.zaytsev.yuketanghelper.network.YuketangParser
import org.json.JSONArray

/** Owned by the session, so alerts do not depend on an Activity being visible or alive. */
class ProblemNotifications(context: Context) {
    private val context = context.applicationContext
    private val manager = this.context.getSystemService(NotificationManager::class.java)
    private val history = this.context.getSharedPreferences("problem_alert_history", Context.MODE_PRIVATE)

    init {
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "新题目提醒", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "已连接课堂发布新题目时，显示课堂名称和作答时限"
                enableVibration(true)
            })
    }

    fun bannersAllowed(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CHANNEL)?.importance?.let { it >= NotificationManager.IMPORTANCE_HIGH } != false)

    fun show(environment: Environment, lesson: Lesson, unlock: YuketangParser.Unlock, enabled: Boolean, answered: Boolean = false): Boolean {
        val now = System.currentTimeMillis()
        if (answered || unlock.deadline?.let { it <= now } == true) return false
        val key = JSONArray().put(environment.name).put(lesson.id).put(unlock.id).toString()
        val seen = runCatching { JSONArray(history.getString("seen", "[]")) }.getOrDefault(JSONArray())
        if ((0 until seen.length()).any { seen.optString(it) == key }) return false
        // Remember even muted events: enabling reminders later should not replay old questions.
        val next = JSONArray()
        for (i in (seen.length() - 499).coerceAtLeast(0) until seen.length()) next.put(seen.getString(i))
        next.put(key)
        history.edit().putString("seen", next.toString()).apply()
        if (!enabled || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return false
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return false
        val classroom = lesson.title.ifBlank { "当前课堂" }.let { if (it.endsWith("课堂")) it else "${it}课堂" }
        val title = "${classroom}发布了一个问题"
        val limit = unlock.deadline?.let { deadline ->
            val seconds = ((deadline - unlock.at + 999) / 1000).coerceAtLeast(1)
            "时限 ${seconds} 秒"
        } ?: "未定时限"
        val intent = Intent(context, MainActivity::class.java).apply {
            action = ACTION_OPEN
            data = Uri.Builder().scheme("ykt-helper").authority("problem").appendPath(environment.name)
                .appendPath(lesson.id).appendPath(unlock.id).build()
            putExtra(EXTRA_ENVIRONMENT, environment.name)
            putExtra(EXTRA_LESSON, lesson.id)
            putExtra(EXTRA_PROBLEM, unlock.id)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_assistant).setContentTitle(title).setContentText(limit)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$title\n$limit · 点击查看题目"))
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_EVENT).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .apply { unlock.deadline?.let { setTimeoutAfter((it - now).coerceAtLeast(1)) } }.build()
        return try {
            manager.notify(TAG_PREFIX + key, NOTIFICATION_ID, notification)
            true
        } catch (_: SecurityException) { false } // Permission can be revoked between the check and notify.
    }

    fun clear() {
        manager.activeNotifications.filter { it.tag?.startsWith(TAG_PREFIX) == true }
            .forEach { manager.cancel(it.tag, it.id) }
    }

    companion object {
        const val CHANNEL = "new_problems"
        const val ACTION_OPEN = "com.zaytsev.yuketanghelper.OPEN_PROBLEM"
        const val EXTRA_ENVIRONMENT = "notification_environment"
        const val EXTRA_LESSON = "notification_lesson"
        const val EXTRA_PROBLEM = "notification_problem"
        private const val TAG_PREFIX = "problem:"
        private const val NOTIFICATION_ID = 20
    }
}
