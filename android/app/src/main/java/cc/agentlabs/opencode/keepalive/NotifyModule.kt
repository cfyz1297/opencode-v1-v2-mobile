package cc.agentlabs.opencode.keepalive

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import cc.agentlabs.opencode.R
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactMethod

/**
 * Posts the app's event notifications.
 *
 * expo-notifications can only use one small icon for every notification (the
 * manifest's `expo.modules.notifications.default_notification_icon`), and that
 * icon was the full-colour app icon — Android renders such a bitmap as a white
 * square in the status bar. Posting from here allows one monochrome icon per
 * category (question / error / completed / permission).
 *
 * Tapping opens the app through the same deep link the router already handles
 * (`opencode://session/<id>`), so notification taps do not need a second
 * routing path in JS.
 */
class NotifyModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "Notify"

  // Promise, not a return value: the bridge only accepts void or Promise from a
  // @ReactMethod, and JS needs to know whether the alert actually went out.
  @ReactMethod
  fun notify(category: String, title: String, body: String, sessionId: String, channelId: String, promise: Promise) {
    try {
      val manager = context.getSystemService(NotificationManager::class.java)
      val notification =
        NotificationCompat.Builder(context, channelId)
          // Small icons are monochrome masks: white on transparent, or Android
          // draws a white square.
          .setSmallIcon(iconFor(category))
          .setContentTitle(title)
          .setContentText(body)
          .setStyle(NotificationCompat.BigTextStyle().bigText(body))
          .setAutoCancel(true)
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setCategory(NotificationCompat.CATEGORY_STATUS)
          .setContentIntent(openAppIntent(sessionId))
          .build()

      // A stable id per session+category replaces the previous alert of the
      // same kind instead of stacking up ("task completed" five times).
      manager.notify(idFor(category, sessionId), notification)
      promise.resolve(true)
    } catch (error: Exception) {
      Log.e("Notify", "could not post a $category notification", error)
      promise.reject("notify_failed", error.message, error)
    }
  }

  private fun iconFor(category: String): Int =
    when (category) {
      "questions" -> R.drawable.notif_question
      "errors" -> R.drawable.notif_error
      "completed" -> R.drawable.notif_completed
      "permissions" -> R.drawable.notif_permission
      else -> R.drawable.notif_default
    }

  private fun idFor(category: String, sessionId: String): Int = "$category:$sessionId".hashCode()

  private fun openAppIntent(sessionId: String): PendingIntent {
    // ACTION_MAIN (the launcher intent) drops the data URI, so the session link
    // has to be an ACTION_VIEW aimed at the same activity.
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val intent =
      if (sessionId.isEmpty()) {
        launch ?: Intent(Intent.ACTION_MAIN).setPackage(context.packageName)
      } else {
        Intent(Intent.ACTION_VIEW, Uri.parse("opencode://session/$sessionId")).apply {
          launch?.component?.let { component = it }
        }
      }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      idFor("open", sessionId),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
