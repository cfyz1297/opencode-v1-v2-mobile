package cc.agentlabs.opencode.keepalive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import cc.agentlabs.opencode.R

/**
 * Keeps the app process at foreground importance while an agent run is active.
 *
 * Android freezes a cached React Native process within seconds of the app
 * leaving the foreground, which kills the SSE stream the in-app notifications
 * are generated from: "task completed", permission and question alerts then
 * never fire while the phone is locked. A foreground service keeps the process
 * (and the socket) alive; the system shows this quiet ongoing notification.
 */
class KeepAliveService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "OpenCode"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    createChannel(title)

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.notification_icon)
      .setContentTitle(title)
      .setContentText(body)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // NOT sticky: a process kill must not resurrect a notification for a run
    // the app no longer knows about.
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannel(title: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, title, NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      },
    )
  }

  companion object {
    const val CHANNEL_ID = "keepalive"
    const val NOTIFICATION_ID = 4242
    const val EXTRA_TITLE = "keepalive_title"
    const val EXTRA_BODY = "keepalive_body"
  }
}
