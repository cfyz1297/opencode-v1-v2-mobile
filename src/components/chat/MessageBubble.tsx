import { memo, useCallback, useEffect, useState } from "react"
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import * as Clipboard from "expo-clipboard"
import { useTranslation } from "react-i18next"
import { Markdown } from "../markdown"
import { ActivitySpoiler } from "./ActivitySpoiler"
import { ToolCallCard } from "./ToolCallCard"
import { CompactionCard } from "./CompactionCard"
import { groupParts } from "../../lib/part-runs"
import type { RunTotals } from "../../lib/message-run"
import type { Message, Part } from "../../lib/sdk"

const SCREEN_WIDTH = Dimensions.get("window").width

function isImageMime(mime?: string): boolean {
  return !!mime && mime.startsWith("image/")
}

interface Props {
  message: Message
  parts: Part[]
  isDark: boolean
  // Only wired up for user messages — long-press opens the "Edit message" /
  // revert action sheet. Identified by messageID (not a closure over parts)
  // so it stays correct even if the memo below bails on a stale render.
  onLongPress?: (messageID: string) => void
  // Reverts the session to (just before) this message — desktop's
  // "reset to this point". Offered on user messages only.
  onRevert?: (messageID: string) => void
  // Set for assistant steps that continue a tool-using run above them: the
  // header is shown once per run, not per step.
  continued?: boolean
  // False for every step of a run except the newest: the token/cost footer
  // only makes sense once, at the end.
  showMeta?: boolean
  // Tokens/cost summed over the whole run (see runTotals). Falls back to the
  // message's own usage when the caller has no run context (demo screen).
  totals?: RunTotals
}

// TODO: Replace with streamdown-rn once React 19 types PR lands - it has
// built-in block-level memoization that eliminates re-renders for stable blocks
export const MessageBubble = memo(
  function MessageBubble({
    message,
    parts,
    isDark,
    onLongPress,
    onRevert,
    continued = false,
    showMeta = true,
    totals,
  }: Props) {
    const isUser = message.role === "user"
    const { t } = useTranslation()
    const [copied, setCopied] = useState(false)

    const textParts = parts.filter((p) => p.type === "text")
    const fileParts = parts.filter((p) => p.type === "file" && isImageMime(p.mime))
    const text = textParts.map((p) => p.text).join("\n") || ""
    // Assistant steps render as a timeline in the order the model produced
    // them (see groupParts); user messages stay a single text block.
    const items = isUser ? [] : groupParts(parts)

    // Copy the message's plain text (same content markdown renders). A failed
    // copy stays silent — a per-message alert row would be noise.
    const handleCopy = useCallback(async () => {
      try {
        await Clipboard.setStringAsync(text)
        setCopied(true)
      } catch {
        // ignore — nothing sane to do inside a per-row button
      }
    }, [text])

    // Auto-clear the "Copied" flash; the timeout is a no-op after unmount.
    useEffect(() => {
      if (!copied) return
      const id = setTimeout(() => setCopied(false), 1500)
      return () => clearTimeout(id)
    }, [copied])

    // Compaction messages carry the stored summary instead of regular text
    // parts — render them as the TUI's separator + summary block.
    const compactionPart = parts.find((p) => p.type === "compaction")
    if (compactionPart) return <CompactionCard part={compactionPart} isDark={isDark} />

    const interactive = isUser && !!onLongPress
    const bubbleStyle = [
      s.bubble,
      isUser ? s.user : s.assistant,
      isUser && isDark && s.userDark,
      !isUser && isDark && s.assistantDark,
      continued && s.continued,
    ]

    const body = (
      <>
        {/* Role indicator — shown once per run, so a tool-using turn does not
            repeat "Assistant + model" above every single step. */}
        {!continued && (
          <View style={s.header}>
            <Ionicons
              name={isUser ? "person" : "sparkles"}
              size={14}
              color={isUser ? (isDark ? "#ffffff" : "#0a0a0a") : "#8b5cf6"}
            />
            <Text style={[s.role, isUser && s.roleUser, isDark && s.textWhite]}>
              {isUser ? t("history.user") : t("history.assistant")}
            </Text>
            {message.model && <Text style={[s.modelTag, isDark && s.modelTagDark]}>{message.model.modelID}</Text>}
            {!isUser && message.modelID && <Text style={[s.modelTag, isDark && s.modelTagDark]}>{message.modelID}</Text>}
          </View>
        )}

        {/* Image attachments */}
        {fileParts.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.imageRow}
            style={s.imageScroll}
          >
            {fileParts.map((fp) => (
              <View key={fp.id} style={s.imageWrap}>
                <Image source={{ uri: fp.url }} style={s.attachedImage} resizeMode="cover" />
                {fp.filename && (
                  <Text style={[s.imageLabel, isDark && s.imageLabelDark]} numberOfLines={1}>
                    {fp.filename}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
        )}

        {/* Assistant timeline: answers stay on screen, everything the model did
            between them (thinking + tool calls) folds into one spoiler row. */}
        {items.map((item) => {
          if (item.kind === "text") {
            return (
              <View key={item.key} style={s.markdownWrap}>
                <Markdown>{item.part.text!}</Markdown>
              </View>
            )
          }
          if (item.kind === "delegation") {
            return <ToolCallCard key={item.key} tool={item.tool} isDark={isDark} />
          }
          return (
            <ActivitySpoiler
              key={item.key}
              reasoning={item.reasoning}
              tools={item.tools}
              isDark={isDark}
            />
          )
        })}

        {/* Why the run stopped. A failed run keeps its reason on the message
            and renders no text, so without this row the chat looks like it
            simply stopped answering. */}
        {!isUser && message.error && (
          <View style={s.errorRow}>
            <Ionicons name="alert-circle" size={14} color="#ef4444" />
            <Text style={s.errorText} selectable>
              {message.error.message || t("chat.message.failed")}
            </Text>
          </View>
        )}

        {/* User text */}
        {isUser && text.length > 0 && (
          <Text style={[s.messageText, isDark && s.textWhite]} selectable>
            {text}
          </Text>
        )}

        {/* Per-message actions — desktop parity: copy + "reset to this point".
            Shown under the bubble content so both icons are separate buttons. */}
        {(text.length > 0 || (isUser && !!onRevert)) && (
          <View style={s.actionRow}>
            {text.length > 0 && (
              <TouchableOpacity
                style={s.actionBtn}
                onPress={handleCopy}
                accessibilityRole="button"
                accessibilityLabel={t("chat.message.copy")}
                testID={`message-copy-${message.role}`}
              >
                <Ionicons
                  name={copied ? "checkmark" : "copy-outline"}
                  size={12}
                  color={isDark ? "#888888" : "#777777"}
                />
                <Text style={[s.actionText, isDark && s.actionTextDark]}>{copied ? t("chat.message.copied") : t("chat.message.copy")}</Text>
              </TouchableOpacity>
            )}
            {isUser && !!onRevert && (
              <TouchableOpacity
                style={s.actionBtn}
                onPress={() => onRevert(message.id)}
                accessibilityRole="button"
                accessibilityLabel={t("chat.message.revertHere")}
                testID="message-revert"
              >
                <Ionicons name="arrow-undo-outline" size={12} color={isDark ? "#888888" : "#777777"} />
                <Text style={[s.actionText, isDark && s.actionTextDark]}>{t("chat.message.revertHere")}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Tokens/cost for the whole run — once, at its last step */}
        {!isUser && showMeta && (totals || message.tokens) && (
          <Text style={[s.tokens, isDark && s.tokensDark]}>
            {totals?.tokens ?? message.tokens!.input + message.tokens!.output} {t("chat.message.tokens")}
            {(totals?.cost ?? message.cost) ? ` · $${(totals?.cost ?? message.cost!).toFixed(4)}` : ""}
          </Text>
        )}
      </>
    )

    // Only user bubbles are tappable (long-press = edit/revert). Assistant
    // bubbles stay a plain View: wrapping them in a Touchable steals the
    // long-press that <Text selectable> needs on Android, which is why their
    // text could not be selected or copied at all.
    if (interactive) {
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onLongPress={() => onLongPress!(message.id)}
          style={bubbleStyle}
          testID={`chat-bubble-${message.role}`}
        >
          {body}
        </TouchableOpacity>
      )
    }

    return (
      <View style={bubbleStyle} testID={`chat-bubble-${message.role}`}>
        {body}
      </View>
    )
  },
  (prev, next) => {
    // Only re-render if message content actually changed
    // This prevents completed messages from re-rendering during streaming.
    // The store replaces changed parts/messages with NEW object references,
    // so a reference-equality sweep over every part catches every real change
    // (including tool parts, which have no `.text`) while still skipping
    // unchanged (completed) messages during other messages' streaming.
    if (prev.message !== next.message) return false
    if (prev.isDark !== next.isDark) return false
    if (prev.onLongPress !== next.onLongPress) return false
    if (prev.onRevert !== next.onRevert) return false
    if (prev.continued !== next.continued) return false
    if (prev.showMeta !== next.showMeta) return false
    // runTotals rebuilds its objects on every transcript update, so compare the
    // values — a reference check would re-render every bubble while streaming.
    if (prev.totals?.tokens !== next.totals?.tokens || prev.totals?.cost !== next.totals?.cost) return false
    if (prev.parts.length !== next.parts.length) return false
    for (let i = 0; i < prev.parts.length; i++) {
      if (prev.parts[i] !== next.parts[i]) return false
    }
    return true
  },
)

const s = StyleSheet.create({
  bubble: { marginBottom: 16, maxWidth: "100%" },
  // Continuation of the assistant run above: sits flush under it so a turn with
  // many tool steps reads as one card instead of a stack of bubbles.
  continued: { marginBottom: 2 },
  // User messages keep a bubble; assistant output is a flat timeline so tool
  // rows and text sit directly on the background, as in the TUI.
  user: { backgroundColor: "#f5f5f5", marginLeft: 32, padding: 12, borderRadius: 12 },
  userDark: { backgroundColor: "#1a1a1a" },
  assistant: {},
  assistantDark: {},

  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  role: { fontSize: 13, fontWeight: "600", color: "#666666" },
  roleUser: { color: "#0a0a0a" },
  textWhite: { color: "#ffffff" },

  modelTag: {
    fontSize: 11,
    color: "#999999",
    backgroundColor: "#e5e5e5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  modelTagDark: { backgroundColor: "#2a2a2a", color: "#888888" },

  // No lineHeight: React Native's CustomLineHeightSpan forces the last line's
  // box to fm.descent, which clips fonts whose glyphs reach below their
  // reported descent (any device font but Roboto). Same rule as the markdown
  // theme, see src/components/markdown/Markdown.tsx.
  messageText: { fontSize: 15, color: "#0a0a0a" },
  markdownWrap: { marginHorizontal: -4 },

  tokens: { fontSize: 11, color: "#999999", marginTop: 8 },
  tokensDark: { color: "#666666" },

  // Per-message action buttons (copy / reset-to-this-point), desktop parity.
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2 },
  actionText: { fontSize: 11, color: "#777777" },
  actionTextDark: { color: "#888888" },

  // Failed run: the server's reason, verbatim.
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  errorText: { fontSize: 13, lineHeight: 19, color: "#ef4444", flex: 1 },

  // Images
  imageScroll: { marginBottom: 8 },
  imageRow: { gap: 8 },
  imageWrap: { alignItems: "center" },
  attachedImage: {
    width: Math.min(200, SCREEN_WIDTH * 0.5),
    height: Math.min(200, SCREEN_WIDTH * 0.5),
    borderRadius: 8,
    backgroundColor: "#e5e5e5",
  },
  imageLabel: { fontSize: 10, color: "#666666", marginTop: 2, maxWidth: 200 },
  imageLabelDark: { color: "#888888" },
})
