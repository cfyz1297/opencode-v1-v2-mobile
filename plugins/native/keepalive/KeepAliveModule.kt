package cc.agentlabs.opencode.keepalive

import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class KeepAliveModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "KeepAlive"

  @ReactMethod
  fun start(title: String, body: String) {
    try {
      val intent = Intent(context, KeepAliveService::class.java)
        .putExtra(KeepAliveService.EXTRA_TITLE, title)
        .putExtra(KeepAliveService.EXTRA_BODY, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    } catch (e: Exception) {
      // Android 12+ forbids starting a foreground service from the background.
      // The run keeps going, it just loses the keep-alive.
      Log.w("KeepAlive", "could not start the keep-alive service", e)
    }
  }

  @ReactMethod
  fun stop() {
    try {
      context.stopService(Intent(context, KeepAliveService::class.java))
    } catch (e: Exception) {
      Log.w("KeepAlive", "could not stop the keep-alive service", e)
    }
  }
}
