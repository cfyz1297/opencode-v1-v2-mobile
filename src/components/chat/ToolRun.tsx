import { useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import type { Part } from "../../lib/sdk"
import { isCommandRun } from "../../lib/part-runs"
import { isLiveTool } from "../../lib/tool-summary"
import { ToolCallCard } from "./ToolCallCard"

interface Props {
  tools: Part[]
  isDark: boolean
}

// Two or more back-to-back tool calls collapse into one "Ran N commands" row,
// mirroring the TUI's timeline: the whole run is one line until the user taps
// it, then each call is its own expandable row.
export function ToolRun({ tools, isDark }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  // A lone call has nothing to fold — render it directly so it stays one tap
  // away from its output.
  if (tools.length === 1) return <ToolCallCard tool={tools[0]} isDark={isDark} />

  const running = tools.some(isLiveTool)
  const failed = tools.some((tool) => tool.state?.status === "error")
  const label = t(isCommandRun(tools) ? "chat.toolRun.commands" : "chat.toolRun.tools", {
    n: tools.length,
  })

  return (
    <View>
      <TouchableOpacity style={s.header} onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
        <Ionicons
          name={isCommandRun(tools) ? "terminal-outline" : "extension-puzzle-outline"}
          size={14}
          color={failed ? "#ef4444" : isDark ? "#b0b0b0" : "#555555"}
        />
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
        <View style={s.nested}>
          {tools.map((tool) => (
            <ToolCallCard key={tool.id} tool={tool} isDark={isDark} />
          ))}
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3, marginTop: 2 },
  label: { fontSize: 12.5, fontWeight: "500", color: "#555555", flex: 1 },
  labelDark: { color: "#b0b0b0" },
  nested: { paddingLeft: 12 },
})
