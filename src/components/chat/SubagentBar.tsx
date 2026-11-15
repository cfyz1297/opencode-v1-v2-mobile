import { useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { useEvents } from "../../stores/events"
import { useSessions } from "../../stores/sessions"
import {
  deriveSubagentStatus,
  orderSubagents,
  visibleSubagents,
  type SubagentRef,
} from "../../lib/subagent-status"
import { SubagentRow } from "./SubagentRow"

interface Props {
  refs: readonly SubagentRef[]
  isDark: boolean
}

type View_ = "current" | "all"

/**
 * Two counters under the header:
 *
 *   left  — the current batch: the subagents delegated by the latest prompt,
 *           running and just finished alike, plus anything still working from
 *           an earlier prompt (a long-running child must not vanish when a new
 *           batch starts). Spinner while any of them works, check once none does.
 *   right — every subagent this session has delegated, in call order.
 *
 * Both open the same list component over their own set, running rows first, so
 * "who is working" and "who worked" stay one tap apart.
 */
export function SubagentBar({ refs, isDark }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<View_ | null>(null)
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

  const current = visibleSubagents(refs, statusOf)
  const running = refs.filter((ref) => statusOf(ref) === "running").length
  const shown = open === "all" ? orderSubagents(refs, statusOf) : orderSubagents(current, statusOf)

  const toggle = (view: View_) => setOpen((value) => (value === view ? null : view))

  return (
    <View style={[s.wrap, isDark && s.wrapDark]}>
      <View style={s.buttons}>
        <TouchableOpacity
          onPress={() => toggle("current")}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t("chat.subagents.now", { count: current.length })}
          style={[s.button, open === "current" && s.buttonOpen, running > 0 && s.buttonActive]}
          testID="subagents-current"
        >
          {running > 0 ? (
            <ActivityIndicator size="small" color="#f59e0b" />
          ) : (
            <Ionicons name="checkmark-circle-outline" size={16} color="#22c55e" />
          )}
          <Text style={[s.buttonText, isDark && s.buttonTextDark]} numberOfLines={1}>
            {t("chat.subagents.now", { count: current.length })}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => toggle("all")}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t("chat.subagents.total", { count: refs.length })}
          style={[s.button, open === "all" && s.buttonOpen]}
          testID="subagents-all"
        >
          <Ionicons name="git-branch-outline" size={14} color={isDark ? "#a78bfa" : "#6d28d9"} />
          <Text style={[s.buttonText, isDark && s.buttonTextDark]} numberOfLines={1}>
            {t("chat.subagents.total", { count: refs.length })}
          </Text>
          <Ionicons
            name={open === "all" ? "chevron-up" : "chevron-down"}
            size={12}
            color={isDark ? "#666666" : "#999999"}
          />
        </TouchableOpacity>
      </View>

      {open !== null && (
        <ScrollView
          style={s.list}
          // A long session can delegate many times; the bar must not eat the
          // transcript, so the list stops at about six rows and scrolls.
          contentContainerStyle={s.listContent}
          nestedScrollEnabled
        >
          {shown.map((ref) => (
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
  buttonOpen: { borderWidth: 1, borderColor: "#c4b5fd" },
  buttonActive: { backgroundColor: "#fef3c7" },
  buttonText: { fontSize: 11, fontWeight: "600", color: "#0a0a0a" },
  buttonTextDark: { color: "#ffffff" },
  list: { maxHeight: 260, marginBottom: 6 },
  listContent: { paddingBottom: 2 },
})
