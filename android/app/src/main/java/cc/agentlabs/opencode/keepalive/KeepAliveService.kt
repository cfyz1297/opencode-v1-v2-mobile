package cc.agentlabs.opencode.keepalive

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
 * Two things are needed, and the previous version only did the first:
 *
 *  1. A foreground service, so Android does not freeze or kill the process.
 *  2. A **headless JS task**, because React Native stops its timers as soon as
 *     the host is paused: JavaTimerManager drops the frame callback while
 *     `isPaused && !hasActiveTasks()` (node_modules/react-native/.../
 *     JavaTimerManager.kt). setInterval simply never fires in the background,
 *     so the JS background watch polled exactly once and then went silent —
 *     which is why notifications only appeared after reopening the app.
 *
 * The task's promise never settles on its own: it stays pending for as long as
 * the run lasts, which is what keeps `hasActiveTasks()` true. JS resolves it on
 * stop() (see src/lib/keep-alive.ts).
 */
class KeepAliveService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "OpenCode"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    // Hidden channel: the service keeps its foreground status, but the user
    // does not get a second "Session running" card next to the real alerts.
    hideKeepAliveChannel(this, title)
    showOngoing(title, body)
    // Base class starts the headless task (and every task start posts the same
    // intent again, so this method always runs first).
    super.onStartCommand(intent, flags, startId)
    // HeadlessJsTaskService returns START_REDELIVER_INTENT, so after the process
    // is killed Android restarts the service and boots a *headless* React
    // instance in the background. The next launch then attaches an Activity to
    // a React host that was started without one: the splash never hides and the
    // app closes on its own. The task never completes by design, so redelivery
    // buys nothing.
    return START_NOT_STICKY
  }

  // Android 15 limits dataSync foreground services to 6 hours per 24, then kills
  // the app unless the service stops itself. The type is specialUse from API 34
  // (see showOngoing), which has no limit; this is the fallback for the older
  // layout and for a device that still enforces the dataSync budget.
  override fun onTimeout(startId: Int) {
    stopSelf(startId)
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf(startId)
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

  private fun showOngoing(title: String, body: String) {
    val notification =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.notif_default)
        .setContentTitle(title)
        .setContentText(body)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setSilent(true)
        .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // dataSync is capped at 6h/24h from Android 15 and the system kills the
      // app when the budget runs out — exactly the "long background run" case
      // this service exists for. specialUse (API 34+) has no limit and is the
      // honest description: keeping the session's stream open to post alerts.
      val type =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        }
      startForeground(NOTIFICATION_ID, notification, type)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    // Removes the "Session running" card. Cancelling an FGS notification does
    // not demote the service — the system lets these be dismissed (users can
    // swipe them since Android 13) — so the process and the headless task keep
    // running. Deliberately NOT deleting the channel: that pulls the
    // notification out from under the system and crashed the app in 0.3.16.
    getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
  }

  companion object {
    const val CHANNEL_ID = "keepalive"
    const val NOTIFICATION_ID = 4242
    const val TASK_KEY = "KeepAliveBackground"
    const val EXTRA_TITLE = "keepalive_title"
    const val EXTRA_BODY = "keepalive_body"
  }
}
