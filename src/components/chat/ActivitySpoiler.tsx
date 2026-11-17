import { useEffect, useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import type { Part } from "../../lib/sdk"
import { formatToolDuration } from "../../lib/tool-duration"
import { summarizeToolActivity, toolKind } from "../../lib/tool-summary"
import { ReasoningBlock } from "./ReasoningBlock"
import { ToolRun } from "./ToolRun"

interface Props {
  // The segment's reasoning, already merged by groupParts.
  reasoning?: Part
  tools: Part[]
  isDark: boolean
}

// A running block's total has to move, otherwise it reads as a frozen 0.0s for
// the whole call. Same one-second clock the tool cards use.
function useTickingNow(running: boolean, start: number | undefined): number | undefined {
  const [now, setNow] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!running || !start) {
      setNow(undefined)
      return
    }
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running, start])
  return now
}

// One spoiler per segment between two answers: the model's thinking and every
// tool call it made there, collapsed into a single line so a long run cannot
// push the answer off the screen.
//
// The collapsed line says what the run used, like the desktop client does:
// "5 · Shell, Read · 12.3s". Opening it shows the same rows as before — this
// only decides what is on screen at rest, not how a tool card looks.
export function ActivitySpoiler({ reasoning, tools, isDark }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  // The segment's first start anchors the clock; a segment with two running
  // calls already gets its sum from the tools' own timestamps.
  const firstStart = tools.find((tool) => tool.state?.time?.start)?.state?.time?.start
  const now = useTickingNow(tools.some((tool) => tool.state?.status === "running"), firstStart)
  const summary = summarizeToolActivity(tools, now)
  const reasonCount = reasoning ? 1 : 0
  const steps = tools.length + reasonCount
  const names = summary.kinds.map((kind) => t(`chat.toolKind.${kind}`)).join(", ")
  const duration = formatToolDuration(0, summary.totalMs)
  const headline = tools.length > 0 ? `${summary.count}` : t("chat.activity.thought", { count: steps })
  const label = [headline, names, duration].filter(Boolean).join(" · ")
  // Spoken form is not the compact line: "5 tools: Shell, Read, 12.3 seconds".
  const speech = t("chat.activity.summary", {
    count: steps,
    kinds: names || t("chat.activity.thought", { count: steps }),
    time: duration ?? "",
  })

  return (
    <View style={[s.block, isDark && s.blockDark]}>
      <TouchableOpacity
        style={s.header}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={speech}
        testID="activity-spoiler"
      >
        <Ionicons name="layers-outline" size={14} color={isDark ? "#8b8b8b" : "#666666"} />
        <Text style={[s.count, isDark && s.countDark]}>{headline}</Text>
        {names !== "" && (
          <Text style={[s.label, isDark && s.labelDark]} numberOfLines={1}>
            {names}
          </Text>
        )}
        {duration && <Text style={[s.duration, isDark && s.durationDark]}>{duration}</Text>}
        {summary.running ? (
          <ActivityIndicator size="small" color="#f59e0b" />
        ) : summary.failed ? (
          <Ionicons name="close" size={14} color="#ef4444" />
        ) : (
          <Ionicons name="checkmark" size={14} color="#22c55e" />
        )}
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={isDark ? "#555555" : "#aaaaaa"} />
      </TouchableOpacity>
      {expanded && (
        <View style={s.body}>
          {reasoning?.text && (
            <ReasoningBlock text={reasoning.text} time={reasoning.time} isDark={isDark} />
          )}
          {tools.length > 0 && <ToolRun tools={tools} isDark={isDark} />}
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  block: {
    marginVertical: 4,
    borderLeftWidth: 2,
    borderLeftColor: "#e5e5e5",
    paddingLeft: 8,
  },
  blockDark: { borderLeftColor: "#262626" },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3 },
  // The count is the anchor of the line and never shrinks; the tool names take
  // whatever width is left and ellipsize.
  count: { fontSize: 12.5, fontWeight: "700", color: "#555555" },
  countDark: { color: "#b0b0b0" },
  label: { fontSize: 12.5, fontWeight: "500", color: "#555555", flexShrink: 1 },
  labelDark: { color: "#b0b0b0" },
  duration: { fontSize: 11.5, color: "#8a8a8a", fontWeight: "500" },
  durationDark: { color: "#7a7a7a" },
  body: {},
})
