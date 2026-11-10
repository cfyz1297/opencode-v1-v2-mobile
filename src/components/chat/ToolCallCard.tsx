import { useState, useCallback, useEffect } from "react"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import type { Part } from "../../lib/sdk"
import { DiffView } from "./DiffView"
import { isShellTool, toolCommand, toolDetailText, toolTitle } from "../../lib/tool-view"
import { formatToolDuration } from "../../lib/tool-duration"

const TOOL_ICONS: Record<string, string> = {
  read: "glasses-outline",
  list: "list-outline",
  glob: "search-outline",
  grep: "search-outline",
  webfetch: "globe-outline",
  edit: "code-slash-outline",
  write: "create-outline",
  apply_patch: "git-merge-outline",
  bash: "terminal-outline",
  shell: "terminal-outline",
  task: "git-branch-outline",
  todowrite: "checkbox-outline",
  todoread: "checkbox-outline",
  question: "chatbubble-ellipses-outline",
  codesearch: "search-outline",
  websearch: "globe-outline",
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

function statusColor(status: string): string {
  if (status === "completed") return "#22c55e"
  if (status === "error") return "#ef4444"
  if (status === "running") return "#f59e0b"
  return "#888888"
}

// --- Tool-specific detail renderers ---

function BashDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const cmd = typeof input === "object" && input !== null ? (input as Record<string, unknown>).command : undefined
  const out = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {typeof cmd === "string" && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable>
            <Text style={s.codePrompt}>$ </Text>
            {cmd}
          </Text>
        </View>
      )}
      {out !== undefined && out.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={80}>
            {out}
          </Text>
        </View>
      )}
    </View>
  )
}

function ReadDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const offset = typeof input === "object" && input !== null ? (input as Record<string, unknown>).offset : undefined
  const limit = typeof input === "object" && input !== null ? (input as Record<string, unknown>).limit : undefined
  const range = offset || limit ? ` (${offset || 0}..${limit || "end"})` : ""
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
          {range}
        </Text>
      )}
    </View>
  )
}

function WriteDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const content = typeof input === "object" && input !== null ? (input as Record<string, unknown>).content : undefined
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
        </Text>
      )}
      {typeof content === "string" && content.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={40}>
            {content}
          </Text>
        </View>
      )}
    </View>
  )
}

function EditDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const old = typeof input === "object" && input !== null ? (input as Record<string, unknown>).oldString : undefined
  const replacement =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>).newString : undefined

  // If we have old/new strings, show as diff
  if (typeof old === "string" && typeof replacement === "string") {
    return (
      <View style={s.detailSection}>
        {typeof file === "string" && (
          <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
            {file}
          </Text>
        )}
        <DiffView before={old} after={replacement} isDark={isDark} />
      </View>
    )
  }

  // Fallback: show raw output
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2)
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
        </Text>
      )}
      {text && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={40}>
            {text}
          </Text>
        </View>
      )}
    </View>
  )
}

function PatchDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const patch = typeof input === "object" && input !== null ? (input as Record<string, unknown>).patch : undefined
  return (
    <View style={s.detailSection}>
      {typeof patch === "string" && patch.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={60}>
            {patch}
          </Text>
        </View>
      )}
    </View>
  )
}

function GlobGrepDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const { t } = useTranslation()
  const pattern = typeof input === "object" && input !== null ? (input as Record<string, unknown>).pattern : undefined
  const path = typeof input === "object" && input !== null ? (input as Record<string, unknown>).path : undefined
  const results = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {typeof pattern === "string" && (
        <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>
          {typeof path === "string"
            ? t("chat.toolCallCard.patternWithPath", { pattern, path })
            : t("chat.toolCallCard.patternOnly", { pattern })}
        </Text>
      )}
      {results && results.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={30}>
            {results}
          </Text>
        </View>
      )}
    </View>
  )
}

function WebfetchDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const url = typeof input === "object" && input !== null ? (input as Record<string, unknown>).url : undefined
  return (
    <View style={s.detailSection}>
      {typeof url === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark, { color: "#8b5cf6" }]} selectable numberOfLines={3}>
          {url}
        </Text>
      )}
    </View>
  )
}

function TaskDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const description =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>).description : undefined
  const prompt = typeof input === "object" && input !== null ? (input as Record<string, unknown>).prompt : undefined
  return (
    <View style={s.detailSection}>
      {typeof description === "string" && <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>{description}</Text>}
      {typeof prompt === "string" && prompt.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={20}>
            {prompt}
          </Text>
        </View>
      )}
    </View>
  )
}

function TodoDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const todos = typeof input === "object" && input !== null ? (input as Record<string, unknown>).todos : undefined
  if (!Array.isArray(todos)) return null
  return (
    <View style={s.detailSection}>
      {todos.map((t, i) => {
        const item = t as Record<string, unknown>
        const done = item.status === "completed"
        return (
          <View key={String(item.id || i)} style={s.todoRow}>
            <Ionicons
              name={done ? "checkbox" : "square-outline"}
              size={16}
              color={done ? "#22c55e" : isDark ? "#666666" : "#999999"}
            />
            <Text style={[s.todoText, isDark && s.todoTextDark, done && s.todoDone]} numberOfLines={2}>
              {String(item.content || item.title || "")}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

function GenericDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const text = toolDetailText(input, output)
  if (!text) return null
  return (
    <View style={s.detailSection}>
      <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
        <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={30}>
          {text}
        </Text>
      </View>
    </View>
  )
}

function ToolDetail({ tool, isDark }: { tool: Part; isDark: boolean }) {
  const name = tool.tool || ""
  const input = tool.state?.input
  const output = tool.state?.output

  switch (name) {
    case "bash":
    case "shell":
      return <BashDetail input={input} output={output} isDark={isDark} />
    case "read":
      return <ReadDetail input={input} isDark={isDark} />
    case "write":
      return <WriteDetail input={input} isDark={isDark} />
    case "edit":
      return <EditDetail input={input} output={output} isDark={isDark} />
    case "apply_patch":
      return <PatchDetail input={input} isDark={isDark} />
    case "glob":
    case "grep":
    case "list":
    case "codesearch":
      return <GlobGrepDetail input={input} output={output} isDark={isDark} />
    case "webfetch":
    case "websearch":
      return <WebfetchDetail input={input} isDark={isDark} />
    case "task":
      return <TaskDetail input={input} isDark={isDark} />
    case "todowrite":
      return <TodoDetail input={input} isDark={isDark} />
    default:
      return <GenericDetail input={input} output={output} isDark={isDark} />
  }
}

// --- Error display ---
function ErrorBanner({ message, isDark }: { message: string; isDark: boolean }) {
  return (
    <View style={[s.errorBanner, isDark && s.errorBannerDark]}>
      <Ionicons name="alert-circle" size={14} color="#ef4444" />
      <Text style={s.errorText} numberOfLines={3} selectable>
        {message}
      </Text>
    </View>
  )
}

// --- Duration display ---
// A running tool has no end timestamp, so it needs a clock that ticks: without
// one the row stayed blank for the whole call and a long command looked frozen.
function useRunningClock(start: number | undefined, running: boolean): number | undefined {
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

// --- Main component ---
interface Props {
  tool: Part
  isDark: boolean
}

export function ToolCallCard({ tool, isDark }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const icon = (tool.tool && TOOL_ICONS[tool.tool]) || "extension-puzzle-outline"
  const status = tool.state?.status || "pending"
  const color = statusColor(status)
  const error = tool.state?.error?.message
  const now = useRunningClock(tool.state?.time?.start, status === "running")
  const elapsed = formatToolDuration(tool.state?.time?.start, tool.state?.time?.end, now)
  // An empty object is what a tool sends at input.started, before any argument
  // has arrived: counting it as detail gave a chevron that opened onto nothing.
  const hasDetail =
    toolDetailText(tool.state?.input, tool.state?.output) !== undefined ||
    isShellTool(tool.tool) ||
    !!error
  const title = toolTitle(tool, t("chat.toolCallCard.fallbackTitle"))
  const isCommand = isShellTool(tool.tool) && !!toolCommand(tool.state?.input)

  const toggle = useCallback(() => {
    if (hasDetail) setExpanded((v) => !v)
  }, [hasDetail])

  return (
    <TouchableOpacity
      style={s.card}
      onPress={toggle}
      activeOpacity={hasDetail ? 0.7 : 1}
    >
      {/* Header row */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Ionicons name={icon as any} size={14} color={color} />
          <Text
            style={[s.name, isDark && s.nameDark, isCommand ? s.nameMono : null]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {elapsed && <Text style={[s.elapsed, isDark && s.elapsedDark]}>{elapsed}</Text>}
        </View>
        <View style={s.headerRight}>
          {status === "running" && <ActivityIndicator size="small" color={color} />}
          {status === "completed" && <Ionicons name="checkmark" size={14} color="#22c55e" />}
          {status === "error" && <Ionicons name="close" size={14} color="#ef4444" />}
          {hasDetail && (
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={isDark ? "#555555" : "#aaaaaa"}
            />
          )}
        </View>
      </View>

      {/* Error banner */}
      {error && !expanded && <ErrorBanner message={error} isDark={isDark} />}

      {/* Expanded detail — grows with the row instead of scrolling inside it,
          so the transcript scrolls as one surface. */}
      {expanded && (
        <View style={s.detail}>
          {error && <ErrorBanner message={error} isDark={isDark} />}
          <ToolDetail tool={tool} isDark={isDark} />
        </View>
      )}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  // Flat row: no card chrome, so a turn with many tool steps stays a compact
  // list instead of a stack of boxes.
  card: { marginTop: 2 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { fontSize: 12.5, fontWeight: "500", color: "#555555", flexShrink: 1 },
  nameDark: { color: "#b0b0b0" },
  nameMono: { fontFamily: mono, fontSize: 12 },
  elapsed: { fontSize: 10.5, color: "#999999" },
  elapsedDark: { color: "#666666" },

  // Error
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 4,
    padding: 8,
    backgroundColor: "#fef2f2",
    borderRadius: 6,
  },
  errorBannerDark: { backgroundColor: "#1a0a0a" },
  errorText: { fontSize: 12, color: "#dc2626", flex: 1, lineHeight: 18 },

  // Detail — indented under the row's icon so nested calls read as children.
  detail: { marginTop: 2, marginBottom: 4, paddingLeft: 20 },
  detailSection: { gap: 4 },
  detailFile: {
    fontSize: 12,
    fontFamily: mono,
    color: "#6d28d9",
    backgroundColor: "#f5f3ff",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: "hidden",
  },
  detailFileDark: { color: "#a78bfa", backgroundColor: "#1a1a2e" },
  detailMeta: { fontSize: 12, color: "#666666", lineHeight: 18 },
  detailMetaDark: { color: "#888888" },

  // Code block
  codeBlock: {
    backgroundColor: "#f8f8f8",
    borderRadius: 6,
    padding: 10,
  },
  codeBlockDark: { backgroundColor: "#1a1a1a" },
  codePre: {
    fontSize: 12,
    fontFamily: mono,
    color: "#0a0a0a",
    lineHeight: 18,
  },
  codePteDark: { color: "#e5e5e5" },
  codePrompt: { color: "#8b5cf6", fontWeight: "700" },

  // Todo
  todoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 3,
  },
  todoText: { fontSize: 13, color: "#0a0a0a", flex: 1, lineHeight: 20 },
  todoTextDark: { color: "#e5e5e5" },
  todoDone: { textDecorationLine: "line-through", color: "#999999" },
})
