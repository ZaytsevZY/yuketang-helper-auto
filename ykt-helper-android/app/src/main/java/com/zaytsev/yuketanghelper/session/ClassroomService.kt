package com.zaytsev.yuketanghelper.session

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.zaytsev.yuketanghelper.HelperApplication
import com.zaytsev.yuketanghelper.MainActivity
import com.zaytsev.yuketanghelper.R

class ClassroomService : Service() {
    private val session get() = (application as HelperApplication).session
    private val listener: () -> Unit = { updateNotification() }
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel("classroom", "课堂连接", NotificationManager.IMPORTANCE_LOW))
        }
        session.observe(listener)
        session.onSessionEnded = { stopSelf() }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") { session.disconnect(); stopSelf(); return START_NOT_STICKY }
        if (intent?.action == "pause") session.saveSettings(session.settings.settings().copy(autoSubmit = false))
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(10, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(10, notification())
        } catch (e: RuntimeException) {
            session.report("系统未允许后台课堂服务，请保持应用在前台使用")
            stopSelf()
        }
        // Do not silently reconnect or resume auto submission after system process death.
        return START_NOT_STICKY
    }
    private fun notification(): Notification {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), flags)
        val stop = PendingIntent.getService(this, 1, Intent(this, ClassroomService::class.java).setAction("stop"), flags)
        val pause = PendingIntent.getService(this, 2, Intent(this, ClassroomService::class.java).setAction("pause"), flags)
        return NotificationCompat.Builder(this, "classroom")
            .setSmallIcon(R.drawable.ic_assistant).setContentTitle("雨课堂助手 · ${if(session.state.online) "上课中" else "连接中"}")
            .setContentText(if(session.settings.settings().autoSubmit) "自动回答已开启" else "${session.state.connected?.problems?.size ?: 0} 道题目 · 自动提交关闭")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(0, "暂停自动提交", pause).addAction(0, "退出课堂", stop).build()
    }
    private fun updateNotification() {
        if (session.state.active) getSystemService(NotificationManager::class.java).notify(10, notification())
    }
    override fun onTimeout(startId: Int, fgsType: Int) {
        session.disconnect()
        session.report("系统后台运行时间已到，请打开应用重新连接课堂")
        stopSelf()
    }
    override fun onDestroy() {
        session.unobserve(listener); session.onSessionEnded = null
        // The foreground activity may still own the session. On a task swipe, onTaskRemoved stops it.
        super.onDestroy()
    }
    override fun onTaskRemoved(rootIntent: Intent?) { session.disconnect(); stopSelf() }
    override fun onBind(intent: Intent?): IBinder? = null
}
