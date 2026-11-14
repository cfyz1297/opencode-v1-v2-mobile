// Expo prebuild rewrites every file it owns on every run, so native
// customizations cannot live in android/ — they are re-applied here instead.
const fs = require('fs')
const path = require('path')
const {
  withAppBuildGradle,
  withMainActivity,
  withMainApplication,
  withAndroidManifest,
  withDangerousMod,
  createRunOncePlugin,
} = require('expo/config-plugins')

const KEEPALIVE_PACKAGE = 'cc.agentlabs.opencode.keepalive'

const SIGNING = `        if (System.getenv("RELEASE_STORE_FILE")) {
            release {
                storeFile file(System.getenv("RELEASE_STORE_FILE"))
                storePassword System.getenv("RELEASE_STORE_PASSWORD")
                keyAlias System.getenv("RELEASE_KEY_ALIAS")
                keyPassword System.getenv("RELEASE_KEY_PASSWORD")
                // Sign with v1+v2 only. A v2+v3 block pair crashes the androguard
                // version fdroidserver uses ("'NoOverwriteDict' object has no
                // attribute 'append'"), which broke the self-hosted F-Droid repo
                // publish from v0.4.2 on. v1+v2 installs on all supported API levels
                // and matches the known-good published APK. Re-enable v3 only once
                // fdroidserver/androguard ships the fix.
                enableV1Signing true
                enableV2Signing true
                enableV3Signing false
                enableV4Signing false
            }
        }
`

const IME_FIELD = `  /** Last reported IME height in dp; -1 means "nothing reported yet". */
  private var reportedImeDp = -1f
`

// Shrinks the app's root view to sit above the soft keyboard, and reports the
// IME height to JS as the \`imeInset\` device event. Needed because edge-to-edge
// keeps the window full-height while RN's keyboard events never fire under
// bridgeless; RN Modals are separate windows and use the reported height.
// Keep in sync with src/lib/use-keyboard-height.ts.
const IME_METHODS = `
  private fun installImeReporter() {
    val content = findViewById<View>(android.R.id.content) ?: return
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      if (view.paddingBottom != imeBottom) view.updatePadding(bottom = imeBottom)
      reportIme(imeBottom)
      // Never consume: the rest of the view tree still needs these insets.
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }

  /** @param px IME inset in physical pixels, 0 when the keyboard is hidden. */
  private fun reportIme(px: Int) {
    val heightDp = px / resources.displayMetrics.density
    val context = (application as? ReactApplication)?.reactHost?.currentReactContext ?: return
    if (heightDp == reportedImeDp) return
    reportedImeDp = heightDp
    val payload = Arguments.createMap()
    payload.putDouble("height", heightDp.toDouble())
    payload.putBoolean("visible", heightDp > 0f)
    context.emitDeviceEvent("imeInset", payload)
  }

`

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents

    // Inside signingConfigs, right after the generated debug block: the debug
    // keystore password closes that block, then signingConfigs closes.
    if (!src.includes('RELEASE_STORE_FILE')) {
      const anchor = /( {12}keyPassword 'android'\n {8}\}\n)( {4}\}\n {4}buildTypes \{)/
      if (!anchor.test(src)) throw new Error('with-native-customizations: signingConfigs anchor not found')
      src = src.replace(anchor, `$1${SIGNING}$2`)
    }
    // Only the release build type switches to the production key; the debug
    // build type keeps the generated debug keystore.
    // AGP 9 rejects `proguard-android.txt` outright ("no longer supported since
    // it includes -dontoptimize"), so the template's optimize file stays. The
    // non-optimize variant was only there for the F-Droid scanner, and store
    // publishing is gone.
    const templateReleaseSigning =
      '            // Caution! In production, you need to generate your own keystore file.\n' +
      '            // see https://reactnative.dev/docs/signed-apk-android.\n' +
      '            signingConfig signingConfigs.debug\n'
    if (src.includes(templateReleaseSigning)) {
      src = src.replace(templateReleaseSigning, "            signingConfig signingConfigs.findByName('release') ?: signingConfigs.debug\n")
    }

    if (!src.includes('dependenciesInfo')) {
      src = src.replace(
        /(    androidResources \{\n        ignoreAssetsPattern [^\n]*\n    \}\n)/,
        `$1    dependenciesInfo {
        // Disable encrypted dependency metadata signing block (0x504B4453).
        // Required for F-Droid compliance — fdroid scanner rejects APKs containing this block.
        includeInApk false
        includeInBundle false
    }
`,
      )
    }

    cfg.modResults.contents = src
    return cfg
  })
}

function withImeReporter(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('with-ime-reporter expects the Kotlin MainActivity')
    }
    let src = cfg.modResults.contents
    if (src.includes('installImeReporter')) {
      cfg.modResults.contents = src
      return cfg
    }

    src = src.replace(
      'import android.os.Bundle\n',
      'import android.os.Bundle\nimport android.view.View\n\n' +
        'import androidx.core.view.ViewCompat\nimport androidx.core.view.WindowInsetsCompat\nimport androidx.core.view.updatePadding\n',
    )
    src = src.replace(
      'import com.facebook.react.ReactActivity\n',
      'import com.facebook.react.ReactActivity\nimport com.facebook.react.ReactApplication\nimport com.facebook.react.bridge.Arguments\n',
    )
    src = src.replace(/(class MainActivity : ReactActivity\(\) \{\n)/, `$1${IME_FIELD}`)
    src = src.replace(/(    super\.onCreate\(null\)\n)/, '$1    installImeReporter()\n')
    src = src.replace(/\n  \/\*\*\n   \* Returns the name of the main component/, `${IME_METHODS}  /**\n   * Returns the name of the main component`)

    if (!src.includes('installImeReporter()')) {
      throw new Error('with-ime-reporter could not patch MainActivity')
    }

    cfg.modResults.contents = src
    return cfg
  })
}

function withCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0]
    if (!application) throw new Error('with-native-customizations: no <application> in manifest')
    // SDK 58 dropped `android.usesCleartextTraffic` from the config schema and
    // prebuild silently ignores it. The app talks to opencode over plain
    // http://127.0.0.1, which Android blocks by default since API 28.
    application.$['android:usesCleartextTraffic'] = 'true'
    return cfg
  })
}

// --- Keep-alive foreground service -------------------------------------------
//
// Android freezes a backgrounded RN process, which kills the SSE socket the
// in-app notifications are generated from. The service is started while an
// agent run is active and stopped when it ends (see src/lib/keep-alive.ts).

function withKeepAliveSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const source = path.join(__dirname, 'native', 'keepalive')
      const destination = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        'cc',
        'agentlabs',
        'opencode',
        'keepalive',
      )
      fs.mkdirSync(destination, { recursive: true })
      for (const file of fs.readdirSync(source)) {
        fs.copyFileSync(path.join(source, file), path.join(destination, file))
      }
      // Monochrome notification icons. They must live in res/, and they replace
      // the full-colour PNG expo-notifications would use as the status-bar icon
      // (Android draws such a bitmap as a white square).
      const resSource = path.join(__dirname, 'native', 'res')
      const resTarget = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res')
      for (const folder of fs.readdirSync(resSource)) {
        fs.mkdirSync(path.join(resTarget, folder), { recursive: true })
        for (const file of fs.readdirSync(path.join(resSource, folder))) {
          fs.copyFileSync(path.join(resSource, folder, file), path.join(resTarget, folder, file))
        }
      }
      return cfg
    },
  ])
}

function withKeepAliveManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest
    const permissions = manifest['uses-permission'] || []
    for (const name of [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
    ]) {
      if (!permissions.some((permission) => permission.$['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } })
      }
    }
    manifest['uses-permission'] = permissions

    const application = manifest.application?.[0]
    if (!application) throw new Error('with-native-customizations: no <application> in manifest')
    const services = application.service || []
    if (!services.some((service) => service.$['android:name'] === `${KEEPALIVE_PACKAGE}.KeepAliveService`)) {
      services.push({
        $: {
          'android:name': `${KEEPALIVE_PACKAGE}.KeepAliveService`,
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
        },
      })
    }
    application.service = services

    // Status-bar icon for anything posted through expo-notifications (iOS has
    // no such concept; on Android this now covers the test notification and any
    // future path). Must be set after the expo-notifications plugin, hence the
    // plugin order in app.json.
    const metaData = application['meta-data'] || []
    const iconKey = 'expo.modules.notifications.default_notification_icon'
    const withoutOld = metaData.filter((entry) => entry.$['android:name'] !== iconKey)
    withoutOld.push({
      $: { 'android:name': iconKey, 'android:resource': '@drawable/notif_default' },
    })
    application['meta-data'] = withoutOld
    return cfg
  })
}

function withKeepAliveRegistration(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('with-keep-alive expects the Kotlin MainApplication')
    }
    let src = cfg.modResults.contents
    if (!src.includes('KeepAlivePackage')) {
      src = src.replace(
        'import com.facebook.react.ReactPackage\n',
        `import com.facebook.react.ReactPackage\nimport ${KEEPALIVE_PACKAGE}.KeepAlivePackage\nimport ${KEEPALIVE_PACKAGE}.NotifyPackage\n`,
      )
      src = src.replace(
        /(\n\s*)\/\/ add\(MyReactNativePackage\(\)\)\n/,
        '$1add(KeepAlivePackage())\n$1add(NotifyPackage())\n',
      )
    }
    if (!src.includes('add(KeepAlivePackage())') || !src.includes('add(NotifyPackage())')) {
      throw new Error('with-keep-alive could not register the packages in MainApplication')
    }
    cfg.modResults.contents = src
    return cfg
  })
}

module.exports = createRunOncePlugin(
  (config) =>
    withCleartextTraffic(
      withImeReporter(withKeepAliveRegistration(withKeepAliveManifest(withKeepAliveSources(withReleaseSigning(config))))),
    ),
  'with-native-customizations',
  '1.0.0',
)
