import { useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useEvents } from "../../stores/events"
import { useSessions } from "../../stores/sessions"
import { deriveSubagentStatus, orderSubagents, type SubagentRef } from "../../lib/subagent-status"
import { SubagentRow } from "./SubagentRow"

interface Props {
  refs: readonly SubagentRef[]
  isDark: boolean
}

/**
 * Two counters under the header: what is working right now, and everything this
 * session has delegated. Tapping either opens the same list — running rows
 * first, then call order — because "who is working" and "who worked" are the
 * same question asked at two moments.
 *
 * Rendered only when the session has delegated at least once, so a plain chat
 * keeps its full height.
 */
export function SubagentBar({ refs, isDark }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const live = useEvents((s) => s.sessionStatus)
  const errors = useEvents((s) => s.sessionErrors)
  const children = useSessions((s) => s.childrenByParent)

  if (refs.length === 0) return null

  const statusOf = (ref: SubagentRef) =>
    deriveSubagentStatus(
      (ref.parentID ? children[ref.parentID] : undefined)?.find((c) => c.id === ref.sessionID),
      live[ref.sessionID],
      errors[ref.sessionID],
    )
  const running = refs.filter((ref) => statusOf(ref) === "running").length
  const ordered = orderSubagents(refs, statusOf)

  const toggle = () => setOpen((value) => !value)

  return (
    <View style={[s.wrap, isDark && s.wrapDark]}>
      <View style={s.buttons}>
        {/* What is running now: spinner while it works, check once nothing is. */}
        <TouchableOpacity
          onPress={toggle}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t("chat.subagents.working", { count: running })}
          style={[s.button, running > 0 && s.buttonActive]}
          testID="subagents-running"
        >
          {running > 0 ? (
            <ActivityIndicator size="small" color="#f59e0b" />
          ) : (
            <Ionicons name="checkmark-circle-outline" size={16} color="#22c55e" />
          )}
          <Text style={[s.buttonText, isDark && s.buttonTextDark]} numberOfLines={1}>
            {t("chat.subagents.working", { count: running })}
          </Text>
        </TouchableOpacity>

        {/* Everything this session delegated. */}
        <TouchableOpacity
          onPress={toggle}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t("chat.subagents.total", { count: refs.length })}
          style={s.button}
          testID="subagents-all"
        >
          <Ionicons name="git-branch-outline" size={14} color={isDark ? "#a78bfa" : "#6d28d9"} />
          <Text style={[s.buttonText, isDark && s.buttonTextDark]} numberOfLines={1}>
            {t("chat.subagents.total", { count: refs.length })}
          </Text>
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={12}
            color={isDark ? "#666666" : "#999999"}
          />
        </TouchableOpacity>
      </View>

      {open && (
        <ScrollView
          style={s.list}
          // Long sessions can delegate many times; the bar must not eat the
          // transcript, so the list stops at about six rows and scrolls.
          contentContainerStyle={s.listContent}
          nestedScrollEnabled
        >
          {ordered.map((ref) => (
            <SubagentRow
              key={ref.sessionID}
              sessionID={ref.sessionID}
              parentID={ref.parentID}
              agent={ref.agent}
              fallbackTitle={ref.title}
              testIDPrefix="subagent-bar-row"
              isDark={isDark}
            />
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e5e5", paddingHorizontal: 12 },
  wrapDark: { borderBottomColor: "#2a2a2a" },
  buttons: { flexDirection: "row", gap: 8, paddingVertical: 6 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#f2f2f2",
  },
  buttonActive: { backgroundColor: "#fef3c7" },
  buttonText: { fontSize: 11, fontWeight: "600", color: "#0a0a0a" },
  buttonTextDark: { color: "#ffffff" },
  list: { maxHeight: 260, marginBottom: 6 },
  listContent: { paddingBottom: 2 },
})
