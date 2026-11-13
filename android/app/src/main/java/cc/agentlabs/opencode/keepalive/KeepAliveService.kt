package cc.agentlabs.opencode.keepalive

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import cc.agentlabs.opencode.R
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Keeps an agent run alive (and its notifications arriving) while the app is
 * in the background.
 *
 * Two things are needed:
 *
 *  1. A foreground service, so Android does not freeze or kill the process.
 *  2. A **headless JS task**, because React Native stops its timers as soon as
 *     the host is paused: JavaTimerManager drops the frame callback while
 *     `isPaused && !hasActiveTasks()` (node_modules/react-native/.../
 *     JavaTimerManager.kt). setInterval simply never fires in the background.
 *
 * The task's promise never settles on its own: it stays pending for as long as
 * the run lasts, which is what keeps `hasActiveTasks()` true. JS resolves it on
 * stop() (see src/lib/keep-alive.ts).
 */
class KeepAliveService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "OpenCode"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    showHiddenOngoing(title, body)
    // Base class starts the headless task (and every task start posts the same
    // intent again, so this method always runs first).
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.createMap(),
      // 0 = no timeout: a run can take longer than any fixed value, and a
      // timeout here would terminate the React instance mid-run.
      0,
      // The service is started while the app is still in the foreground.
      true,
    )

  /**
   * Promotes the service to foreground without leaving a card in the shade.
   *
   * There is no documented way to do that: a foreground service must have a
   * notification, and Android promotes the channel of a foreground-service
   * notification to at least IMPORTANCE_LOW — so a channel created with
   * IMPORTANCE_NONE is silently upgraded and the "Session running" card shows up
   * again (which is exactly what happened after the previous attempt).
   *
   * What does work: delete the channel immediately after the service has been
   * promoted. Deleting a channel cancels its notifications, while the service
   * stays in the foreground state, so the process (and the headless task) keep
   * running and nothing is left in the shade. The channel is recreated on the
   * next start.
   */
  private fun showHiddenOngoing(title: String, body: String) {
    val manager = getSystemService(NotificationManager::class.java)
    val notification =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.notif_default)
        .setContentTitle(title)
        .setContentText(body)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Importance is immutable once the channel exists, so an old channel from
      // a previous build (created with LOW) is replaced before startForeground
      // would throw on an unknown/blocked channel.
      manager.getNotificationChannel(CHANNEL_ID)?.let { manager.deleteNotificationChannel(CHANNEL_ID) }
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, title, NotificationManager.IMPORTANCE_NONE).apply {
          setShowBadge(false)
          setSound(null, null)
        },
      )
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    // After startForeground, so the service is already promoted. This is what
    // removes the card; the service keeps running.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.deleteNotificationChannel(CHANNEL_ID)
    } else {
      manager.cancel(NOTIFICATION_ID)
    }
  }

  companion object {
    const val CHANNEL_ID = "keepalive"
    const val NOTIFICATION_ID = 4242
    const val TASK_KEY = "KeepAliveBackground"
    const val EXTRA_TITLE = "keepalive_title"
    const val EXTRA_BODY = "keepalive_body"
  }
}
