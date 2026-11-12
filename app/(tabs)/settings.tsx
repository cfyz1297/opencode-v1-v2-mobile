import { useCallback, useState } from "react"
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  useColorScheme,
  Linking,
  Alert,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { PROVIDERS_ROUTE } from "../../src/lib/providers-ui"
import { useAuth } from "../../src/stores/auth"
import { useSettings } from "../../src/stores/settings"
import { useConnections } from "../../src/stores/connections"
import { useEvents } from "../../src/stores/events"
import type { ServerApiPreference } from "../../src/stores/settings"
import {
  categories,
  categoryMeta,
  setup as setupNotifications,
  granted as notificationsGranted,
  sendTest,
} from "../../src/lib/notifications"
import type { Category } from "../../src/lib/notifications"
import { formatLogLines, getLogEntries } from "../../src/lib/logbuffer"
import { ORIGINAL_REPO_URL, PRIVACY_POLICY_URL, PROJECT_REPO_URL } from "../../src/lib/links"
import { CURRENT_VERSION, checkForUpdate, type AvailableUpdate } from "../../src/lib/update-check"
import type { LocalePreference } from "../../src/lib/i18n/locale-resolve"

function SettingRow({
  icon,
  label,
  description,
  isDark,
  right,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  description?: string
  isDark: boolean
  right?: React.ReactNode
  onPress?: () => void
}) {
  const content = (
    <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
      <View style={[styles.settingIcon, isDark && styles.settingIconDark]}>
        <Ionicons name={icon} size={22} color={isDark ? "#ffffff" : "#0a0a0a"} />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingLabel, isDark && styles.textDark]}>{label}</Text>
        {description && <Text style={[styles.settingDescription, isDark && styles.metaDark]}>{description}</Text>}
      </View>
      {right}
    </View>
  )

  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>
  }

  return content
}

function SettingSection({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>{title}</Text>
      <View style={[styles.sectionContent, isDark && styles.sectionContentDark]}>{children}</View>
    </View>
  )
}

export default function SettingsScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const { settings, hasBiometrics, updateSettings, lock } = useAuth()
  const { notifications, setNotification, locale, setLocale, serverApi, setServerApi } = useSettings()
  const [osGranted, setOsGranted] = useState<boolean | null>(null)
  const [diagnostics, setDiagnostics] = useState("")

  // Settings is where a user goes to ask "what am I running?". Answer it, and if
  // a newer build exists say so here too — the banner on the sessions list is
  // dismissible, this row is not (AGE-110). Uses the same 24h-throttled check,
  // so opening Settings repeatedly costs no extra requests. Checking on focus,
  // not mount: the tab stays mounted for the process lifetime.
  const [updateAvailable, setUpdateAvailable] = useState<AvailableUpdate | null>(null)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      checkForUpdate({ ignoreDismissed: true })
        .then((result) => {
          if (!cancelled) setUpdateAvailable(result)
        })
        .catch(() => undefined)
      return () => {
        cancelled = true
      }
    }, []),
  )

  // Check OS permission state on first toggle attempt
  const handleToggle = useCallback(
    async (category: Category, enabled: boolean) => {
      if (enabled) {
        const ok = await setupNotifications()
        setOsGranted(ok)
        if (!ok) {
          Alert.alert(t("settings.alerts.notificationsDisabledTitle"), t("settings.alerts.notificationsDisabledMessage"))
          return
        }
      }
      setNotification(category, enabled)
    },
    [setNotification, t],
  )

  // Posting a real notification is the only end-to-end check a user can run:
  // a delivered notification is invisible to the app, so a failure would stay
  // silent without this button.
  const handleTestNotification = useCallback(async () => {
    const result = await sendTest(
      t("settings.notifications.test.title"),
      t("settings.notifications.test.body"),
    )
    if (result.ok) {
      Alert.alert(t("settings.notifications.test.okTitle"), t("settings.notifications.test.okMessage"))
      return
    }
    const blocked = result.reason === "denied" || result.reason === "undetermined"
    Alert.alert(
      t("settings.notifications.test.failedTitle"),
      blocked
        ? t("settings.notifications.test.failedPermission")
        : t("settings.notifications.test.failedOther", { reason: result.reason }),
    )
    // Android stops showing the permission dialog after a denial; the only
    // path left is system settings.
    if (blocked) Linking.openSettings()
  }, [t])

  // The user may grant the permission in system settings and come back; read
  // it again on every focus, not once per process.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      notificationsGranted()
        .then((ok) => {
          if (!cancelled) setOsGranted(ok)
        })
        .catch(() => {
          if (!cancelled) setOsGranted(false)
        })
      return () => {
        cancelled = true
      }
    }, []),
  )

  // The reasons the last notifications were (not) posted, straight from the
  // log buffer — refreshed on every focus, i.e. every time the user comes back
  // to check whether a background alert arrived.
  useFocusEffect(
    useCallback(() => {
      setDiagnostics(
        formatLogLines(
          getLogEntries()
            .filter((entry) => ["notifications", "keepalive", "watch"].includes(entry.tag))
            .slice(-8),
        ),
      )
    }, []),
  )
  const localeLabels: Record<LocalePreference, string> = {
    system: t("settings.language.system"),
    en: t("settings.language.en"),
    ru: t("settings.language.ru"),
    "zh-Hans": t("settings.language.zhHans"),
  }

  const handleLanguagePress = useCallback(() => {
    Alert.alert(t("settings.language.title"), undefined, [
      { text: localeLabels.system, onPress: () => setLocale("system") },
      { text: localeLabels.en, onPress: () => setLocale("en") },
      { text: localeLabels.ru, onPress: () => setLocale("ru") },
      { text: localeLabels["zh-Hans"], onPress: () => setLocale("zh-Hans") },
      { text: t("common.cancel"), style: "cancel" },
    ])
  }, [t, setLocale, localeLabels])

  const apiLabels: Record<ServerApiPreference, string> = {
    auto: t("settings.serverApi.auto"),
    v1: t("settings.serverApi.v1"),
    v2: t("settings.serverApi.v2"),
  }

  const applyServerApi = useCallback(
    async (preference: ServerApiPreference) => {
      await setServerApi(preference)
      // Rebuild the active client so the transport changes now instead of on
      // the next launch, then restart the event stream against that client.
      const active = useConnections.getState().activeConnection
      if (active) await useConnections.getState().updateConnection(active.id, {})
      useEvents.getState().connect()
    },
    [setServerApi],
  )

  const handleServerApiPress = useCallback(() => {
    Alert.alert(t("settings.serverApi.title"), t("settings.serverApi.description"), [
      { text: apiLabels.auto, onPress: () => void applyServerApi("auto") },
      { text: apiLabels.v1, onPress: () => void applyServerApi("v1") },
      { text: apiLabels.v2, onPress: () => void applyServerApi("v2") },
      { text: t("common.cancel"), style: "cancel" },
    ])
  }, [t, applyServerApi, apiLabels])

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} contentContainerStyle={styles.content}>
      <SettingRow icon="archive-outline" label={t('history.title')} description={t('history.readOnly')} isDark={isDark} onPress={() => router.push('/history')} />
      <SettingSection title={t("settings.sections.security")} isDark={isDark}>
        <SettingRow
          icon="finger-print"
          label={t("settings.security.biometricOpen.label")}
          description={
            hasBiometrics
              ? t("settings.security.biometricOpen.descriptionEnabled")
              : t("settings.security.biometricOpen.descriptionUnavailable")
          }
          isDark={isDark}
          right={
            <Switch
              value={settings.requireBiometric}
              onValueChange={(value) => updateSettings({ requireBiometric: value })}
              disabled={!hasBiometrics}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        <SettingRow
          icon="lock-closed"
          label={t("settings.security.biometricSend.label")}
          description={t("settings.security.biometricSend.description")}
          isDark={isDark}
          right={
            <Switch
              value={settings.requireBiometricForMessages}
              onValueChange={(value) => updateSettings({ requireBiometricForMessages: value })}
              disabled={!hasBiometrics || !settings.requireBiometric}
              trackColor={{ false: "#767577", true: "#22c55e" }}
            />
          }
        />
        {settings.requireBiometric && (
          <SettingRow
            icon="exit"
            label={t("settings.security.lockNow.label")}
            description={t("settings.security.lockNow.description")}
            isDark={isDark}
            onPress={lock}
            right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#666666" : "#999999"} />}
          />
        )}
      </SettingSection>

      <SettingSection title={t("settings.sections.notifications")} isDark={isDark}>
        {/* The permission state goes first: when Android blocks notifications,
            the four category switches below look perfectly fine and do nothing. */}
        <SettingRow
          icon={osGranted === false ? "notifications-off" : "notifications"}
          label={t("settings.notifications.status.label")}
          description={
            osGranted === null
              ? undefined
              : osGranted
                ? t("settings.notifications.status.granted")
                : t("settings.notifications.status.blocked")
          }
          isDark={isDark}
          right={
            osGranted === false ? (
              <TouchableOpacity onPress={() => Linking.openSettings()} hitSlop={8}>
                <Text style={styles.notificationStatusAction}>{t("settings.notifications.status.openSettings")}</Text>
              </TouchableOpacity>
            ) : osGranted ? (
              <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
            ) : undefined
          }
        />
        <SettingRow
          icon="paper-plane-outline"
          label={t("settings.notifications.test.label")}
          description={t("settings.notifications.test.description")}
          isDark={isDark}
          onPress={handleTestNotification}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
        {categories.map((category) => {
          const meta = categoryMeta[category]
          return (
            <SettingRow
              key={category}
              icon={meta.icon as keyof typeof Ionicons.glyphMap}
              label={t(meta.labelKey)}
              description={t(meta.descriptionKey)}
              isDark={isDark}
              right={
                <Switch
                  value={notifications[category]}
                  onValueChange={(value) => handleToggle(category, value)}
                  trackColor={{ false: "#767577", true: "#22c55e" }}
                />
              }
            />
          )
        })}
        {/* When a notification does not arrive there is nothing to look at:
            Android drops it silently and the app has no error surface. These are
            the app's own last decisions, so the next report can say whether the
            alert was held, suppressed, or never generated at all. */}
        <View style={styles.diagnosticsBlock}>
          <Text style={[styles.diagnosticsHint, isDark && styles.diagnosticsHintDark]}>
            {t("settings.notifications.diagnostics.hint")}
          </Text>
          <Text selectable style={[styles.diagnosticsText, isDark && styles.diagnosticsTextDark]} testID="notification-diagnostics">
            {diagnostics || t("settings.notifications.diagnostics.empty")}
          </Text>
        </View>
      </SettingSection>

      <SettingSection title={t("settings.sections.privacy")} isDark={isDark}>
        <SettingRow
          icon="document-text"
          label={t("settings.privacy.privacyPolicy.label")}
          description={t("settings.privacy.privacyPolicy.description")}
          isDark={isDark}
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          right={<Ionicons name="open-outline" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
      </SettingSection>

      <SettingSection title={t("settings.sections.server")} isDark={isDark}>
        <SettingRow
          icon="server-outline"
          label={t("settings.serverApi.label")}
          description={apiLabels[serverApi]}
          isDark={isDark}
          onPress={handleServerApiPress}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
      </SettingSection>

      <SettingSection title={t("settings.sections.providers")} isDark={isDark}>
        <SettingRow
          icon="cloud-outline"
          label={t("settings.providers.row.label")}
          description={t("settings.providers.row.description")}
          isDark={isDark}
          onPress={() => router.push(PROVIDERS_ROUTE)}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
        <SettingRow
          icon="options-outline"
          label={t("models.title")}
          description={t("models.settingsDescription")}
          isDark={isDark}
          onPress={() => router.push("/models")}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
      </SettingSection>

      <SettingSection title={t("settings.sections.about")} isDark={isDark}>
        <SettingRow
          icon="language"
          label={t("settings.language.label")}
          description={localeLabels[locale]}
          isDark={isDark}
          onPress={handleLanguagePress}
          right={<Ionicons name="chevron-forward" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
        <SettingRow
          icon="information-circle"
          label={t("settings.about.version")}
          // Was hard-coded "1.0.0" — wrong for every build ever shipped, and the
          // one place a user could have checked what they are running while 64%
          // of the base sat on a four-week-old build (AGE-110).
          description={
            updateAvailable
              ? `${CURRENT_VERSION} → ${updateAvailable.version}`
              : `${CURRENT_VERSION} · ${t("update.upToDate")}`
          }
          isDark={isDark}
          onPress={updateAvailable ? () => Linking.openURL(updateAvailable.url) : undefined}
          right={
            updateAvailable ? (
              <Ionicons name="arrow-up-circle" size={20} color={isDark ? "#7dd3fc" : "#0369a1"} />
            ) : undefined
          }
        />
        <SettingRow
          icon="logo-github"
          label={t("settings.about.github.label")}
          description={t("settings.about.github.description")}
          isDark={isDark}
          onPress={() => Linking.openURL(PROJECT_REPO_URL)}
          right={<Ionicons name="open-outline" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
        <SettingRow
          icon="git-branch-outline"
          label={t("settings.about.upstream.label")}
          description={t("settings.about.upstream.description")}
          isDark={isDark}
          onPress={() => Linking.openURL(ORIGINAL_REPO_URL)}
          right={<Ionicons name="open-outline" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
        <SettingRow
          icon="document-text"
          label={t("settings.about.docs.label")}
          description={t("settings.about.docs.description")}
          isDark={isDark}
          onPress={() => Linking.openURL("https://opencode.ai/docs")}
          right={<Ionicons name="open-outline" size={20} color={isDark ? "#666666" : "#999999"} />}
        />
      </SettingSection>

      <View style={styles.footer}>
        <Text style={[styles.footerText, isDark && styles.metaDark]}>{t("settings.footer.appName")}</Text>
        <Text style={[styles.footerText, isDark && styles.metaDark]}>{t("settings.footer.tagline")}</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  containerDark: {
    backgroundColor: "#0a0a0a",
  },
  content: {
    paddingBottom: 32,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666666",
    marginLeft: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  sectionTitleDark: {
    color: "#888888",
  },
  sectionContent: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e5e5e5",
  },
  sectionContentDark: {
    backgroundColor: "#1a1a1a",
    borderColor: "#2a2a2a",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  settingRowDark: {
    borderBottomColor: "#2a2a2a",
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  settingIconDark: {
    backgroundColor: "#2a2a2a",
  },
  settingContent: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: "#0a0a0a",
  },
  textDark: {
    color: "#ffffff",
  },
  diagnosticsBlock: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
  },
  diagnosticsHint: {
    fontSize: 12,
    color: "#999999",
  },
  diagnosticsHintDark: {
    color: "#777777",
  },
  diagnosticsText: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#444444",
  },
  diagnosticsTextDark: {
    color: "#aaaaaa",
  },
  settingDescription: {
    fontSize: 13,
    color: "#666666",
    marginTop: 2,
  },
  notificationStatusAction: {
    fontSize: 14,
    fontWeight: "600",
    color: "#8b5cf6",
  },
  metaDark: {
    color: "#888888",
  },
  footer: {
    alignItems: "center",
    padding: 32,
  },
  footerText: {
    fontSize: 13,
    color: "#999999",
    textAlign: "center",
  },
})
