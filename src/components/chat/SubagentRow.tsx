import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useSessions } from "../../stores/sessions"
import { useEvents } from "../../stores/events"
import { deriveSubagentStatus, subagentSince, subagentStatusKey, type SubagentStatus } from "../../lib/subagent-status"

// Status → pill colour, matching the transcript's existing language
// (ToolCallCard.statusColor: completed green, running amber, error red).
const PILL: Record<SubagentStatus, string> = {
  running: "#f59e0b",
  done: "#22c55e",
  failed: "#ef4444",
  idle: "#888888",
}

function formatRelative(ms: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return t("chat.subagents.justNow")
  if (mins < 60) return t("chat.subagents.minutesAgo", { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t("chat.subagents.hoursAgo", { count: hours })
  return t("chat.subagents.daysAgo", { count: Math.floor(hours / 24) })
}

interface Props {
  /** Child session reported by the `subagent` tool (state.metadata.sessionID). */
  sessionID: string
  /** Session that launched it — the child row lives in its childrenByParent. */
  parentID?: string
  /** Delegated agent name from the tool input ("general", "explore", ...). */
  agent?: string
  /** Shown until the child session arrives from the server. */
  fallbackTitle?: string
  /** Distinguishes the transcript row from the one in the bar's list. */
  testIDPrefix?: string
  isDark: boolean
}

/**
 * One delegated subagent, drawn inside the tool card that launched it. Tapping
 * opens the child session exactly like a session from the Recent list, so a
 * background agent's transcript is one tap away instead of invisible.
 *
 * The parent screen calls loadChildren on focus, so this row only reads.
 */
export function SubagentRow({ sessionID, parentID, agent, fallbackTitle, testIDPrefix = "subagent-row", isDark }: Props) {
  const { t } = useTranslation()
  const router = useRouter()
  const child = useSessions((s) =>
    (parentID ? s.childrenByParent[parentID] : undefined)?.find((c) => c.id === sessionID),
  )
  const loading = useSessions((s) => (parentID ? s.childrenLoading[parentID] : false))
  const live = useEvents((s) => s.sessionStatus[sessionID])
  const error = useEvents((s) => s.sessionErrors[sessionID])

  const status = deriveSubagentStatus(child, live, error)
  const title = child?.title || fallbackTitle || t("chat.subagents.title")
  const since = subagentSince(child)
  const meta = [agent, since ? formatRelative(since, t) : null].filter(Boolean).join(" · ")

  const open = () => {
    router.push({
      pathname: "/session/[id]",
      // The child keeps its parent's workspace; passing its directory through
      // keeps the next screen scoped to the same directory client.
      params: { id: sessionID, ...(child?.directory ? { directory: child.directory } : {}) },
    })
  }

  return (
    <TouchableOpacity
      onPress={open}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t("chat.subagents.open", { title })}
      style={[s.row, isDark && s.rowDark]}
      testID={`${testIDPrefix}-${sessionID}`}
    >
      <View style={s.icon}>
        <Ionicons name="git-branch-outline" size={14} color={isDark ? "#a78bfa" : "#6d28d9"} />
      </View>
      <View style={s.body}>
        <Text style={[s.title, isDark && s.titleDark]} numberOfLines={1}>
          {title}
        </Text>
        {meta !== "" && (
          <Text style={[s.meta, isDark && s.metaDark]} numberOfLines={1}>
            {meta}
          </Text>
        )}
        {status === "failed" && error && (
          <Text style={s.error} numberOfLines={2}>
            {error}
          </Text>
        )}
      </View>
      {loading && !child ? (
        <ActivityIndicator size="small" color="#888888" />
      ) : (
        <View style={[s.pill, { backgroundColor: PILL[status] }]}>
          <Text style={s.pillText}>{t(subagentStatusKey(status))}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={14} color={isDark ? "#555555" : "#aaaaaa"} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 6,
    borderRadius: 8,
    backgroundColor: "#f5f3ff",
  },
  rowDark: { backgroundColor: "#1c1a2e" },
  icon: { width: 16, alignItems: "center" },
  body: { flex: 1, gap: 1 },
  title: { fontSize: 13, fontWeight: "600", color: "#0a0a0a" },
  titleDark: { color: "#ffffff" },
  meta: { fontSize: 11, color: "#666666" },
  metaDark: { color: "#888888" },
  error: { fontSize: 11, color: "#ef4444" },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  pillText: { fontSize: 10, fontWeight: "700", color: "#ffffff" },
})
