import { useEffect, useRef, useState } from "react"
import { Stack, router } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useColorScheme, View, ActivityIndicator, AppState } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet"
import { I18nextProvider, useTranslation } from "react-i18next"
import i18n from "../src/lib/i18n/config"
import { useAuth } from "../src/stores/auth"
import { useConnections } from "../src/stores/connections"
import { useEvents } from "../src/stores/events"
import { useCatalog } from "../src/stores/catalog"
import { useSettings } from "../src/stores/settings"
import { useSessions } from "../src/stores/sessions"
import { offlineHistory } from "../src/lib/history-storage"
import { historySnapshot } from "../src/lib/offline-history"
import { AuthGate } from "../src/components/AuthGate"
import { ErrorBoundary } from "../src/components/ErrorBoundary"
import * as notifications from "../src/lib/notifications"

function RootLayout() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const { initialize: initAuth, isLoading: authLoading } = useAuth()
  const { loadConnections, isLoading: connectionsLoading, client } = useConnections()
  const sseStarted = useRef(false)
  const notifPermissionRequested = useRef(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useSessions.subscribe((state, previous) => {
      if (state.messages === previous.messages && state.parts === previous.parts && state.currentSession === previous.currentSession) return
      if (timer) clearTimeout(timer)
      if (!state.currentSession) return
      const connection = useConnections.getState().activeConnection?.id
      if (!connection) return
      const snapshot = historySnapshot(state.currentSession, state.messages, state.parts)
      timer = setTimeout(() => {
        void (async () => {
          if (useConnections.getState().activeConnection?.id !== connection) return
          await offlineHistory.capture(connection, snapshot)
        })().catch(() => console.warn('Offline history could not be saved'))
      }, 1000)
    })
    return () => { unsubscribe(); if (timer) clearTimeout(timer) }
  }, [])

  useEffect(() => {
    initAuth()
    // Settings first: the stored server-API preference decides which transport
    // loadConnections builds, so reading it after the load would apply a forced
    // version only on the next launch.
    void useSettings.getState().load().then(() => loadConnections())

    // Connect notification preferences to the notification module
    notifications.configure(() => useSettings.getState().notifications)

    // Navigate to session when user taps a notification. Connection-drop
    // notifications carry no sessionId (they aren't about a session) — route
    // to the home tab instead of "/session/" (an empty, dead-end route).
    //
    // Cold-start: when the app is launched from a push tap while the JS
    // process was dead, the response listener below mounts too late — read
    // the initial response first and dedupe against it so the same tap isn't
    // handled twice (BUG-005).
    let initialHandled = false
    let initial: { sessionId?: string; category?: string } | null = null
    ;(async () => {
      const response = await notifications.getInitialResponse()
      if (response) {
        initialHandled = true
        initial = response
        if (response.sessionId) router.push(`/session/${response.sessionId}`)
        else router.push("/")
      }
    })()
    const unsubNotifications = notifications.onTap((data) => {
      if (initialHandled && data.sessionId === initial?.sessionId && data.category === initial?.category) {
        return // already routed from cold-start
      }
      if (data.sessionId) router.push(`/session/${data.sessionId}`)
      else router.push("/")
    })

    return unsubNotifications
  }, [])

  // Re-arm the biometric app-lock when the app leaves the foreground. Without
  // this, "Require Biometric to Open" is bypassable: authenticate() sets
  // isAuthenticated=true once at cold start and nothing ever resets it, so the
  // app stays unlocked for the whole JS-process lifetime — anyone with brief
  // physical access can reopen a backgrounded app straight into session
  // history and connection details. lock() flips isAuthenticated back to false
  // so AuthGate shows the lock screen (and re-prompts) on next foreground.
  // Fire on "background" only (not the transient "inactive" that the biometric
  // prompt / app switcher / control center produce) to avoid spurious re-locks.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" && useAuth.getState().settings.requireBiometric) {
        useAuth.getState().lock()
      }
    })
    return () => sub.remove()
  }, [])

  // Android freezes JS timers and can silently kill the SSE socket while the
  // app is backgrounded. The stall watchdog cannot see that while idle, so a
  // resumed app would show a dead session until the next prompt waited out the
  // 30s window. Reconnect eagerly; a quick app switch keeps the stream.
  useEffect(() => {
    let backgroundedAt: number | null = null
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        backgroundedAt = Date.now()
        // Anything that arrived while the user was still on screen is now
        // unseen: post it instead of dropping it (notifications.flushHeld).
        notifications.flushHeld()
      } else if (next === "active" && backgroundedAt !== null) {
        const elapsed = Date.now() - backgroundedAt
        backgroundedAt = null
        // Whatever was held while returning is already visible on screen.
        notifications.dropHeld()
        useEvents.getState().resumeFromBackground(elapsed)
        // The provider/agent catalog is loaded once per connection. If that
        // one request ran while the phone was locked or the server was down,
        // the model and effort pickers stayed empty for the rest of the
        // session (they only recovered after opening Settings → Models, which
        // calls load() itself). Refreshing here makes a resume self-healing.
        void useCatalog.getState().load()
      }
    })
    return () => sub.remove()
  }, [])

  // Connect/disconnect SSE and load catalog when client changes
  useEffect(() => {
    if (client && !sseStarted.current) {
      sseStarted.current = true
      useEvents.getState().connect()
      useCatalog.getState().load()
      // Request OS notification permission once we have a live connection —
      // the in-context moment the user will start running agent tasks they'll
      // want to be pinged about. Previously this was only ever requested when
      // a user manually toggled a notification switch off→on in Settings; since
      // most categories default on, that path never fired for typical users
      // and send() silently no-op'd on every notification (permission stayed
      // "undetermined"). setup() is idempotent — it won't re-prompt once the
      // OS has a decision — so the ref just avoids redundant calls per session.
      if (!notifPermissionRequested.current) {
        notifPermissionRequested.current = true
        void notifications.setup()
      }
    } else if (!client && sseStarted.current) {
      sseStarted.current = false
      useEvents.getState().disconnect()
    }
    return () => {
      if (sseStarted.current) {
        sseStarted.current = false
        useEvents.getState().disconnect()
      }
    }
  }, [client])

  const isLoading = authLoading || connectionsLoading

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
        }}
      >
        <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
      </View>
    )
  }

  return (
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
            <AuthGate>
            <Stack
              screenOptions={{
                headerStyle: {
                  backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
                },
                headerTintColor: isDark ? "#ffffff" : "#0a0a0a",
                contentStyle: {
                  backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
                },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="session/[id]"
                options={{
                  title: t("session.titleFallback"),
                  presentation: "card",
                }}
              />
              <Stack.Screen
                name="connection/add"
                options={{
                  title: t("nav.addConnectionTitle"),
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="connection/[id]"
                options={{
                  title: t("nav.editConnectionTitle"),
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="providers/index"
                options={{
                  title: t("providers.title"),
                  presentation: "card",
                }}
              />
              <Stack.Screen
                name="providers/custom"
                options={{
                  title: t("providers.custom.title"),
                  presentation: "card",
                }}
              />
              <Stack.Screen
                name="providers/connect"
                options={{
                  title: t("providers.connect.title", { name: "" }),
                  presentation: "card",
                }}
              />
              <Stack.Screen name="models" options={{ title: t("models.title") }} />
            </Stack>
              <StatusBar style={isDark ? "light" : "dark"} />
            </AuthGate>
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
      </I18nextProvider>
    </ErrorBoundary>
  )
}

export default RootLayout
