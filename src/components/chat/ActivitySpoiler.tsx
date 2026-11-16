import { useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import type { Part } from "../../lib/sdk"
import { ReasoningBlock } from "./ReasoningBlock"
import { ToolRun } from "./ToolRun"

interface Props {
  // The segment's reasoning, already merged by groupParts.
  reasoning?: Part
  tools: Part[]
  isDark: boolean
}

// One spoiler per segment between two answers: the model's thinking and every
// tool call it made there, collapsed into a single line so a long run cannot
// push the answer off the screen. Opening it shows the same rows as before —
// this only decides what is on screen at rest, not how a tool card looks.
export function ActivitySpoiler({ reasoning, tools, isDark }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const running = tools.some((tool) => tool.state?.status === "running")
  const failed = tools.some((tool) => tool.state?.status === "error")
  const steps = tools.length + (reasoning ? 1 : 0)
  const label = t("chat.activity.steps", { n: steps })

  return (
    <View style={[s.block, isDark && s.blockDark]}>
      <TouchableOpacity
        style={s.header}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={label}
        testID="activity-spoiler"
      >
        <Ionicons name="layers-outline" size={14} color={isDark ? "#8b8b8b" : "#666666"} />
        <Text style={[s.label, isDark && s.labelDark]} numberOfLines={1}>
          {label}
        </Text>
        {running ? (
          <ActivityIndicator size="small" color="#f59e0b" />
        ) : failed ? (
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
  label: { fontSize: 12.5, fontWeight: "500", color: "#555555", flex: 1 },
  labelDark: { color: "#b0b0b0" },
  body: {},
})
