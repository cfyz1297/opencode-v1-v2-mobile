import { useEffect, useState } from "react"
import { View, Text, StyleSheet, ActivityIndicator } from "react-native"
import { useTranslation } from "react-i18next"
import { useEvents } from "../../stores/events"
import { useSessions } from "../../stores/sessions"
import { formatDurationMs } from "../../lib/tool-duration"

interface Props {
  sessionID: string
  isDark: boolean
}

export function StatusIndicator({ sessionID, isDark }: Props) {
  const { t } = useTranslation()
  const status = useEvents((s) => s.sessionStatus[sessionID])
  const text = useEvents((s) => s.statusText[sessionID])
  const startedAt = useEvents((s) => s.runStartedAt[sessionID])
  const optimistic = useSessions((s) => s.sending[sessionID])

  // SSE status is the source of truth. The optimistic `sending` flag only
  // covers the gap between the user tapping send and SSE confirming busy.
  // Once SSE reports idle, the indicator hides regardless of the optimistic flag.
  const sseBusy = status && status.type !== "idle"
  const busy = sseBusy || (optimistic && !status)

  // A second per second so the bar proves the run is alive: a frozen label was
  // indistinguishable from a stalled agent while the model was still thinking.
  const [now, setNow] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!busy || !startedAt) {
      setNow(undefined)
      return
    }
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [busy, startedAt])

  if (!busy) return null

  const elapsedMs = startedAt && now ? now - startedAt : undefined
  // "0ms" for the first second reads as a glitch; the clock appears once it
  // has something to show.
  const elapsed = elapsedMs !== undefined && elapsedMs >= 1000 ? formatDurationMs(elapsedMs) : null
  const label =
    status?.type === "retry" ? t("chat.statusIndicator.retrying", { attempt: status.attempt }) : text || t("chat.statusIndicator.working")

  return (
    <View style={[s.bar, isDark && s.barDark]}>
      <ActivityIndicator size="small" color="#8b5cf6" />
      <Text style={[s.text, isDark && s.textDark]}>
        {label}
        {elapsed ? ` · ${elapsed}` : ""}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f5f3ff",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
  },
  barDark: { backgroundColor: "#1a1a2e", borderTopColor: "#2a2a2a" },
  text: { fontSize: 13, color: "#6d28d9", fontWeight: "500" },
  textDark: { color: "#a78bfa" },
})
