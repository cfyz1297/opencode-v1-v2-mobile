/**
 * "A newer version exists" — the only way a sideloaded install ever learns that.
 *
 * Deliberately not a modal: a modal on launch is the fastest way to get an app
 * uninstalled, and this must be safe to ship to the whole install base. It is a
 * single dismissible strip above the session list, with a "Not now" that sticks
 * for that version (see update-check-policy.ts).
 *
 * Renders nothing at all when there is no update, when the check failed, on
 * iOS, or once dismissed — so the common case costs one hook and no pixels.
 */

import { useCallback, useEffect, useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, Linking, AppState } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { checkForUpdate, dismissUpdate, CURRENT_VERSION, type AvailableUpdate } from "../lib/update-check"

export function UpdateBanner({ isDark }: { isDark: boolean }) {
  const { t } = useTranslation()
  const [update, setUpdate] = useState<AvailableUpdate | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      checkForUpdate()
        .then((result) => {
          if (!cancelled) setUpdate(result)
        })
        .catch(() => undefined)
    }
    check()
    // The strip lives on a tab that stays mounted for the whole process
    // lifetime, so a mount-only check would never notice a release published
    // while the app was open (or just backgrounded). The policy throttles this
    // to one request per day.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check()
    })
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [])

  const onDismiss = useCallback(() => {
    if (update) void dismissUpdate(update.version)
    setUpdate(null)
  }, [update])

  const onOpen = useCallback(async () => {
    if (!update) return
    // Opening the release page is also an implicit "I've seen this version":
    // do not nag about it again either. But only dismiss after the URL opens —
    // if openURL fails (no browser), keep the banner visible (BUG-026).
    // openURL resolves to void; only a rejection means it did not open.
    try {
      await Linking.openURL(update.url)
    } catch {
      return
    }
    void dismissUpdate(update.version)
    setUpdate(null)
  }, [update])

  if (!update) return null

  return (
    <View style={[styles.banner, isDark && styles.bannerDark]} testID="update-banner">
      <Ionicons name="arrow-up-circle" size={20} color={isDark ? "#7dd3fc" : "#0369a1"} />
      <View style={styles.text}>
        <Text style={[styles.title, isDark && styles.titleDark]}>{t("update.available")}</Text>
        <Text style={[styles.body, isDark && styles.bodyDark]} numberOfLines={1}>
          {t("update.body", { version: update.version, current: CURRENT_VERSION })}
        </Text>
      </View>
      <TouchableOpacity onPress={onOpen} testID="update-banner-open" hitSlop={8}>
        <Text style={[styles.action, isDark && styles.actionDark]}>{t("update.action")}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDismiss} testID="update-banner-dismiss" hitSlop={8}>
        <Ionicons name="close" size={18} color={isDark ? "#94a3b8" : "#64748b"} />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#e0f2fe",
  },
  bannerDark: {
    backgroundColor: "#0c2b3d",
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0c4a6e",
  },
  titleDark: {
    color: "#e0f2fe",
  },
  body: {
    fontSize: 12,
    color: "#0369a1",
  },
  bodyDark: {
    color: "#94a3b8",
  },
  action: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0369a1",
  },
  actionDark: {
    color: "#7dd3fc",
  },
})
