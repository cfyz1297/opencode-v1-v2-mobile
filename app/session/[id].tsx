import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  useWindowDimensions,
} from "react-native"
import { useLocalSearchParams, useRouter, useFocusEffect, useNavigation } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useKeyboardHeight } from "../../src/lib/use-keyboard-height"
import { buildMessageData, type MessageDataItem } from "../../src/lib/revert-filter"
import { bubbleFlags, runTotals } from "../../src/lib/message-run"
import { shouldFollowBottom } from "../../src/lib/scroll-follow"
import { useTranslation } from "react-i18next"
import * as ImagePicker from "expo-image-picker"
import * as ImageManipulator from "expo-image-manipulator"
import * as Clipboard from "expo-clipboard"
import type BottomSheet from "@gorhom/bottom-sheet"
import {
  MessageBubble,
  PermissionPrompt,
  QuestionPrompt,
  AnsweredQuestionCard,
  StatusIndicator,
  SlashPopover,
  ModelPicker,
  VariantPicker,
  ImageAttachments,
  SessionInfo,
  ContextRing,
  type SlashCommand,
  type Attachment,
} from "../../src/components/chat"
import { useSessions } from "../../src/stores/sessions"
import { computeSessionStats } from "../../src/lib/session-stats"
import { useEvents, refreshPending } from "../../src/stores/events"
import { useConnections } from "../../src/stores/connections"
import { useAuth } from "../../src/stores/auth"
import { useCatalog } from "../../src/stores/catalog"
import { useSpeech } from "../../src/lib/speech"
import { adaptiveLayout } from '../../src/lib/adaptive-layout'
import { TabletSessions } from '../../src/components/TabletSessions'
import { isSafeSessionId } from '../../src/lib/session-id'
import { log } from "../../src/lib/logbuffer"


// --- Builtin slash commands ---
const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    trigger: "new",
    title: "New Session",
    description: "Start a new session",
    icon: "add-circle-outline",
    type: "builtin",
  },
  {
    trigger: "model",
    title: "Switch Model",
    description: "Choose a different model",
    icon: "hardware-chip-outline",
    type: "builtin",
  },
  {
    trigger: "agent",
    title: "Switch Agent",
    description: "Cycle to next agent",
    icon: "person-outline",
    type: "builtin",
  },
  {
    trigger: "compact",
    title: "Compact Session",
    description: "Summarize history to free context",
    icon: "archive-outline",
    type: "builtin",
  },
  {
    trigger: "undo",
    title: "Undo",
    description: "Revert the last message",
    icon: "arrow-undo-outline",
    type: "builtin",
  },
  {
    trigger: "redo",
    title: "Redo",
    description: "Restore reverted messages",
    icon: "arrow-redo-outline",
    type: "builtin",
  },
]

function getShortDir(dir?: string): string | null {
  if (!dir) return null
  const parts = dir.split("/").filter(Boolean)
  return parts[parts.length - 1] || null
}

export default function SessionScreen() {
  const { id: routeId, directory } = useLocalSearchParams<{ id: string; directory?: string }>()
  // A deep link or notification payload is untrusted input: refuse ids that
  // could change the shape of the API path (see session-id.ts).
  const id = isSafeSessionId(routeId) ? routeId : ""
  const router = useRouter()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const window = useWindowDimensions()
  const layout = adaptiveLayout(window.width)

  const flatListRef = useRef<FlatList>(null)
  const modelSheetRef = useRef<BottomSheet>(null)
  const variantSheetRef = useRef<BottomSheet>(null)

  // Both the chip and the /model command open this sheet. An empty catalog
  // means the one load() at connect time failed (or never ran on this
  // connection) — refetch instead of showing a blank list; the sheet fills in
  // as soon as the response lands.
  const openModelPicker = useCallback(() => {
    if (useCatalog.getState().providers.length === 0) void useCatalog.getState().load()
    modelSheetRef.current?.expand()
  }, [])

  // Emulator/tablet size changes can leave the model sheet expanded over the
  // session sidebar; close pickers whenever the window geometry changes.
  useEffect(() => {
    modelSheetRef.current?.close()
    variantSheetRef.current?.close()
  }, [window.width, window.height])
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showInfo, setShowInfo] = useState(false)

  const {
    currentSession,
    messages,
    parts,
    isLoading,
    loadingMore,
    hasMore,
    selectSession,
    sendMessage,
    abortSession,
    loadOlderMessages,
    revertToMessage,
    unrevertSession,
  } = useSessions()

  // Derive sending state for this specific session
  const isSending = useSessions((s) => !!(currentSession && s.sending[currentSession.id]))

  const { authenticateForMessage } = useAuth()
  const { client, clientForDirectory } = useConnections()

  // Use directory-aware client for sessions that belong to a project other than the active one
  const sessionClient = useMemo(
    () => (currentSession?.directory ? (clientForDirectory(currentSession.directory) ?? client) : client),
    [currentSession?.directory, clientForDirectory, client],
  )

  // Catalog
  const catalog = useCatalog()
  const agents = Array.isArray(catalog.agents) ? catalog.agents : []
  const serverCommands = Array.isArray(catalog.commands) ? catalog.commands : []
  const providers = Array.isArray(catalog.providers) ? catalog.providers : []
  const agent = catalog.agent || ""
  const model = catalog.model
  const setModel = catalog.setModel
  const variant = catalog.variant
  const setVariant = catalog.setVariant
  const cycleAgent = catalog.cycleAgent

  // Raw soft-keyboard height for exact composer avoidance (edge-to-edge)
  const kbHeight = useKeyboardHeight()

  // Permission & question state
  const sessionID = currentSession?.id
  const permissions = useEvents((s) => (sessionID ? s.permissions[sessionID] : undefined)) || []
  const questions = useEvents((s) => (sessionID ? s.questions[sessionID] : undefined)) || []
  const answeredQuestions = useEvents((s) => (sessionID ? s.answeredQuestions[sessionID] : undefined)) || []
  const sessionBusy = useEvents((s) => (sessionID ? s.sessionStatus[sessionID]?.type === "busy" : false))
  const canStop = isSending || sessionBusy

  const handleAbort = useCallback(async () => {
    // The store only sets a string error; without this the tap looked ignored.
    if (!(await abortSession())) {
      Alert.alert(t("session.alerts.abortFailedTitle"), t("session.alerts.abortFailedMessage"))
    }
  }, [abortSession, t])
  // Poll while the run is active, including the optimistic window right after
  // sending a message when the busy-status event may not have arrived yet.
  const shouldPollPending = sessionBusy || isSending

  const shortDir = getShortDir(currentSession?.directory)
  const [showScrollButton, setShowScrollButton] = useState(false)
  // Whether new/streaming content should keep the transcript pinned to the
  // newest message. False once the user scrolls up, true again at the bottom.
  const followBottomRef = useRef(true)

  // SSE reconnect banner
  const reconnectAttempts = useEvents((s) => s.reconnectAttempts)
  const connected = useEvents((s) => s.connected)
  const [showConnectedFlash, setShowConnectedFlash] = useState(false)
  const prevReconnecting = useRef(false)

  // Voice input — transcript appends to the text input on completion
  const speech = useSpeech(
    useCallback((text: string) => {
      setInput((prev) => (prev ? prev + " " + text : text))
    }, []),
  )

  // Surface speech recognition failures (e.g. mic permission denied). Keyed
  // on the error value itself so it only fires once per distinct error, not
  // on every re-render while it remains set.
  useEffect(() => {
    if (!speech.error) return
    Alert.alert(t("session.alerts.speechErrorTitle"), t("session.alerts.speechErrorMessage"))
  }, [speech.error, t])

  // Slash command state
  const slashActive = input.startsWith("/") && !input.includes(" ")
  const slashQuery = slashActive ? input.slice(1) : ""

  const allCommands = useMemo<SlashCommand[]>(() => {
    const custom: SlashCommand[] = serverCommands.map((cmd) => ({
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      icon: "code-slash-outline",
      type: "custom",
    }))
    // Builtin titles/descriptions go through i18n so non-English locales see
    // translated commands; the static list above is the English fallback.
    const builtins = BUILTIN_COMMANDS.map((cmd) => ({
      ...cmd,
      title: t(`chat.commands.${cmd.trigger}.title`, { defaultValue: cmd.title }),
      description: t(`chat.commands.${cmd.trigger}.description`, { defaultValue: cmd.description }),
    }))
    // BUG-027: deduplicate triggers — builtin wins over custom with same name
    // (builtins are checked first in handleSend, so custom duplicates are dead).
    const seen = new Set<string>()
    const deduped = [...custom, ...builtins].filter((cmd) => {
      if (seen.has(cmd.trigger)) return false
      seen.add(cmd.trigger)
      return true
    })
    return deduped
  }, [serverCommands, t])

  // While a revert is pending, the reverted message and everything after it
  // still exist server-side (cleanup only runs on the next prompt/unrevert)
  // — hide them client-side so editing feels immediate. Message IDs are
  // lexicographically sortable, same comparison the TUI uses. Optimistic
  // "temp-" IDs (assigned client-side before the server responds, see
  // sendMessage) aren't part of that sort order — always keep them so a
  // message sent concurrently with a revert isn't hidden.
  const revertMessageID = currentSession?.revert?.messageID

  // Inverted FlatList: data is reversed (newest first) so newest renders at bottom.
  // BUG-032: keep a per-message cache so a streaming delta for one message
  // does not allocate new items (and defeat the bubble memo) for the whole chat.
  const messageDataCache = useRef(new Map<string, MessageDataItem>())
  const messageData = useMemo(
    () => buildMessageData(messages || [], parts || {}, revertMessageID, messageDataCache.current),
    [messages, parts, revertMessageID],
  )
  // Consecutive assistant steps (one per tool call) render as one run: shared
  // header at the top, totals at the bottom, no repeated chrome per step.
  const flags = useMemo(() => bubbleFlags(messageData.map((item) => item.message.role)), [messageData])
  // The footer reports what the whole run cost, not just its last step. Since
  // V2.2.5 the server reports cost 0 for paid models too, so price the steps
  // from the catalog instead.
  const prices = useMemo(
    () => new Map(providers.flatMap((p) => p.models.map((m) => [`${p.id}/${m.id}`, m.cost] as const))),
    [providers],
  )
  const totals = useMemo(
    () => runTotals(messageData.map((item) => item.message), (m) => prices.get(`${m.providerID}/${m.modelID}`)),
    [messageData, prices],
  )
  // Drop cached items when switching sessions so the map cannot grow across
  // every session visited in one app run.
  useEffect(() => {
    messageDataCache.current.clear()
  }, [sessionID])

  // Tracks the latest composer text without pulling `input` into
  // handleMessageLongPress's deps — kept as a plain ref assignment (not
  // state) so the callback below stays referentially stable across
  // keystrokes for MessageBubble's custom memo comparator.
  const inputRef = useRef(input)
  inputRef.current = input

  const applyRevertResult = useCallback((result: Awaited<ReturnType<typeof revertToMessage>>) => {
    if (!result.ok) {
      if (result.reason === "unsupported") {
        Alert.alert(t("session.alerts.notSupportedTitle"), t("session.alerts.notSupportedMessage"))
      } else if (result.reason === "auth") {
        Alert.alert(t("session.alerts.revertAuthFailedTitle"), t("session.alerts.revertAuthFailedMessage"))
      } else {
        Alert.alert(t("session.alerts.editFailedTitle"), t("session.alerts.editFailedMessage"))
      }
      return
    }
    setInput(result.text)
    // Restore attachments in the same shape the composer's own picker
    // functions (pickFromLibrary/pickFromCamera/pasteFromClipboard) use.
    setAttachments(
      result.files
        .filter((f): f is typeof f & { url: string; mime: string } => !!f.url && !!f.mime)
        .map((f) => ({ uri: f.url, mime: f.mime, filename: f.filename })),
    )
  }, [t])

  // Stable across renders (reads fresh state via getState() rather than
  // closing over props) so MessageBubble's custom memo comparator can bail
  // safely without risking a stale handler.
  const handleMessageLongPress = useCallback((messageID: string) => {
    Alert.alert(
      t("session.alerts.messageActionsTitle"),
      undefined,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("session.actions.editMessage"),
          onPress: () => {
            const doRevert = async () => {
              const result = await useSessions.getState().revertToMessage(messageID)
              applyRevertResult(result)
            }
            // Editing overwrites the composer — don't silently clobber an
            // in-progress unsent draft.
            if (inputRef.current.trim()) {
              Alert.alert(
                t("session.alerts.replaceDraftTitle"),
                t("session.alerts.replaceDraftMessage"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("session.actions.replace"), style: "destructive", onPress: doRevert },
                ],
                { cancelable: true },
              )
              return
            }
            doRevert()
          },
        },
      ],
      // Android: RN defaults to cancelable:false, which disables the BACK
      // gesture on the sheet — it could only be closed by picking an action.
      { cancelable: true },
    )
  }, [applyRevertResult, t])

  // The per-message "reset to this point" button on user messages: same
  // revertToMessage as "Edit message", but WITHOUT prefilling the composer —
  // the user chose reset, not edit. The reverted banner (with undo) shows
  // because the session's revert state flips server-side.
  const handleMessageRevert = useCallback(
    async (messageID: string) => {
      // Placeholder ids ("temp-…") exist only client-side while the message
      // is being sent — the server has nothing to revert to there, and the
      // request would surface as a generic failure alert.
      if (messageID.startsWith("temp-")) return
      const result = await useSessions.getState().revertToMessage(messageID)
      if (!result.ok) {
        if (result.reason === "unsupported") {
          Alert.alert(t("session.alerts.notSupportedTitle"), t("session.alerts.notSupportedMessage"))
        } else if (result.reason === "auth") {
          Alert.alert(t("session.alerts.revertAuthFailedTitle"), t("session.alerts.revertAuthFailedMessage"))
        } else {
          Alert.alert(t("session.alerts.editFailedTitle"), t("session.alerts.editFailedMessage"))
        }
      }
    },
    [t],
  )

  const scrollToBottom = useCallback((animated = true) => {
    followBottomRef.current = true
    flatListRef.current?.scrollToOffset({ offset: 0, animated })
  }, [])

  // Re-select on every focus, not just mount. currentSession/messages/
  // permissions are a single global store, and the native stack keeps screens
  // underneath a pushed one mounted. Without re-selecting on focus, navigating
  // to another session and back would leave this screen bound to the *other*
  // session's data (and its permission/question prompts) — so a user could
  // approve the wrong session's tool call. useFocusEffect re-binds this screen
  // to its own session whenever it becomes visible again.
  useFocusEffect(
    useCallback(() => {
      if (!id) return
      let cancelled = false
      selectSession(id, directory).then(() => {
        if (cancelled) return
        // Resolve the client from the *selected* session's directory, not the
        // optional route param: a session opened from a notification/favorite
        // may not carry `directory`, and using the active client would query
        // the wrong location for form/permission lists.
        const current = useSessions.getState().currentSession
        if (!current || current.id !== id) return
        const connState = useConnections.getState()
        const c = current.directory
          ? connState.clientForDirectory(current.directory) ?? connState.client
          : connState.client
        if (c) refreshPending(c, id)
      })
      return () => {
        cancelled = true
      }
    }, [id, directory]),
  )

  // Foreground recovery: the OS pauses/kills the SSE connection while the app
  // is in the background, and V2 does not replay missed events. Refresh both
  // the transcript and pending prompts when the user comes back, otherwise a
  // question asked in the meantime stays invisible until the screen is re-opened.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || !sessionID || !sessionClient) return
      void refreshPending(sessionClient, sessionID)
      void useSessions.getState().refreshMessages()
    })
    return () => sub.remove()
  }, [sessionID, sessionClient])

  // Watchdog for the same failure mode while connected: forms are ephemeral
  // events, so a single dropped frame/packet can hide a question until the next
  // manual refresh. While the viewed session is busy (a question blocks the
  // run), poll the pending-form list every few seconds. The request is small
  // and only runs for the session on screen.
  useEffect(() => {
    if (!shouldPollPending || !sessionID || !sessionClient) return
    void refreshPending(sessionClient, sessionID)
    const timer = setInterval(() => {
      void refreshPending(sessionClient, sessionID)
    }, 5000)
    return () => clearInterval(timer)
  }, [shouldPollPending, sessionID, sessionClient])

  // Sync model chip from latest assistant message
  useEffect(() => {
    if (!messages || messages.length === 0) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "assistant" && msg.providerID && msg.modelID) {
        setModel({ providerID: msg.providerID, modelID: msg.modelID })
        return
      }
      if (msg.role === "user" && msg.model) {
        setModel(msg.model)
        return
      }
    }
  }, [currentSession?.id, messages?.length])

  // Builtin command execution — shared between the slash popover, typing
  // "/command" into the composer, and (desktop parity) the undo/redo pair.
  const runBuiltin = useCallback(
    (trigger: string): boolean => {
      switch (trigger) {
        case "new":
          router.back()
          return true
        case "model":
          setInput("")
          openModelPicker()
          return true
        case "agent":
          setInput("")
          cycleAgent()
          return true
        case "compact":
          setInput("")
          if (sessionClient && currentSession) {
            sessionClient.session.compact(currentSession.id).catch((err) => {
              console.error("Compact failed:", err)
              Alert.alert(t("session.alerts.sendFailedTitle"), t("session.alerts.sendFailedMessage"))
            })
          }
          return true
        case "undo":
          setInput("")
          {
            const revertPoint = currentSession?.revert?.messageID
            const lastUser = (messages || [])
              .filter(
                (m) =>
                  m.role === "user" &&
                  !m.id.startsWith("temp-") &&
                  // BUG-012: respect the active revert point — only undo messages
                  // before it, otherwise /undo would skip forward past hidden ones.
                  (!revertPoint || m.id < revertPoint),
              )
              .pop()
            if (lastUser) {
              void useSessions.getState().revertToMessage(lastUser.id).then((res) => {
                // On success the "reverted" banner (with Redo) appears via
                // session.revert; auth/unsupported reasons surface alerts.
                if (!res.ok) {
                  if (res.reason === "auth") {
                    Alert.alert(t("session.alerts.revertAuthFailedTitle"), t("session.alerts.revertAuthFailedMessage"))
                  } else if (res.reason === "unsupported") {
                    Alert.alert(t("session.alerts.notSupportedTitle"), t("session.alerts.notSupportedMessage"))
                  }
                  // reason "error" already lands in the sessions store error.
                }
              })
            }
          }
          return true
        case "redo":
          setInput("")
          void useSessions.getState().unrevertSession()
          return true
        default:
          return false
      }
    },
    [router, cycleAgent, sessionClient, currentSession, messages, t, openModelPicker],
  )

  // Slash command handler
  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.type === "builtin" && runBuiltin(cmd.trigger)) return
      setInput(`/${cmd.trigger} `)
    },
    [runBuiltin],
  )

  // --- Image picking ---

  // Convert any image (including HEIC/HEIF from iOS) to guaranteed JPEG bytes
  const MAX_DIMENSION = 1568 // Anthropic recommended max
  async function toJpeg(uri: string, width: number, height: number): Promise<Attachment> {
    const actions: ImageManipulator.Action[] = []
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height)
      actions.push({ resize: { width: Math.round(width * scale), height: Math.round(height * scale) } })
    }
    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.8,
      base64: true,
    })
    return {
      uri: result.uri,
      mime: "image/jpeg",
      filename: "image.jpg",
      width: result.width,
      height: result.height,
      base64: result.base64 || undefined,
    }
  }

  // Launching the picker while one is already open (a double tap) or while the
  // keyboard is still animating makes Android return a canceled result, which
  // is indistinguishable from the user backing out: the + looked dead.
  const pickingRef = useRef(false)

  const pickFromLibrary = useCallback(async () => {
    if (pickingRef.current) return
    pickingRef.current = true
    const launchLibrary = (legacy: boolean) =>
      ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 1, // full quality - we compress in manipulator
        ...(legacy ? { legacy: true } : {}),
      })
    try {
      Keyboard.dismiss()
      // The system photo picker is an activity outside the app: when the ROM
      // has none (or refuses the intent) the call rejects before any UI, so the
      // user only saw the error alert. ACTION_GET_CONTENT is answered by the
      // file manager on every device.
      let result
      try {
        result = await launchLibrary(false)
      } catch (err) {
        // Release builds drop console output; the log ring buffer travels with
        // diagnostics reports, so the real reason stays visible.
        log.error("ImagePicker", "system picker failed, retrying legacy:", err)
        result = await launchLibrary(true)
      }
      if (result.canceled) return
      const settled = await Promise.allSettled(result.assets.map((a) => toJpeg(a.uri, a.width, a.height)))
      const items = settled.filter((r) => r.status === "fulfilled").map((r) => r.value)
      if (items.length) setAttachments((prev) => [...prev, ...items])
      if (settled.some((r) => r.status === "rejected")) {
        const reasons = settled
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
        console.error("Failed to process image(s):", reasons)
        log.error("ImagePicker", "processing failed:", reasons.join("; "))
        // Same reasoning as the picker branch: without the reason the report
        // only says "try another photo" and the next fix is another guess.
        Alert.alert(t("session.alerts.imageFailedTitle"), `${t("session.alerts.imageFailedMessage")}\n\n${reasons.join("\n")}`)
      }
    } catch (err) {
      // Previously an unhandled rejection here: the picker never opened and the
      // button silently did nothing.
      const reason = err instanceof Error ? err.message : String(err)
      console.error("Failed to open image picker:", err)
      log.error("ImagePicker", reason)
      // Both pickers failed: the reason is the only clue the next report can
      // carry, and the generic message alone cannot tell them apart.
      Alert.alert(t("session.alerts.imageFailedTitle"), `${t("session.alerts.imageFailedMessage")}\n\n${reason}`)
    } finally {
      pickingRef.current = false
    }
  }, [t])

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t("session.alerts.cameraPermissionTitle"), t("session.alerts.cameraPermissionMessage"))
      return
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 })
    if (result.canceled) return
    const a = result.assets[0]
    try {
      const item = await toJpeg(a.uri, a.width, a.height)
      setAttachments((prev) => [...prev, item])
    } catch (err) {
      console.error("Failed to process photo:", err)
      Alert.alert(t("session.alerts.imageFailedTitle"), t("session.alerts.imageFailedMessage"))
    }
  }, [t])

  const pasteFromClipboard = useCallback(async () => {
    try {
      // Try image first
      const hasImage = await Clipboard.hasImageAsync()
      if (hasImage) {
        const img = await Clipboard.getImageAsync({ format: "png" })
        if (img?.data) {
          const uri = img.data.startsWith("data:") ? img.data : `data:image/png;base64,${img.data}`
          const item = await toJpeg(uri, img.size.width, img.size.height)
          setAttachments((prev) => [...prev, item])
          return
        }
      }
      // Fall back to text
      const hasText = await Clipboard.hasStringAsync()
      if (hasText) {
        const text = await Clipboard.getStringAsync()
        if (text) {
          setInput((prev) => prev + text)
          return
        }
      }
      Alert.alert(t("session.alerts.emptyClipboardTitle"), t("session.alerts.emptyClipboardMessage"))
    } catch (err) {
      // A failed clipboard read used to be an unhandled rejection: the button
      // did nothing and said nothing.
      console.error("Failed to read clipboard:", err)
      Alert.alert(t("session.alerts.imageFailedTitle"), t("session.alerts.imageFailedMessage"))
    }
  }, [t])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // --- Send ---
  // Only the request in flight is blocked, not the whole run: the server queues
  // a follow-up prompt while the agent is working, and the user could always
  // type one. Guarding on `isSending` (the run's optimistic flag, cleared only
  // when the session goes idle) made the composer silently ignore every
  // follow-up until the run finished.
  const sendInFlight = useRef(false)

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return
    // BUG-018: in-flight guard — prevent double-send from rapid taps or
    // biometric retry while a previous send is still in progress.
    if (sendInFlight.current) return
    sendInFlight.current = true
    try {
      await sendNow()
    } finally {
      sendInFlight.current = false
    }
  }

  const sendNow = async () => {
    const authenticated = await authenticateForMessage()
    if (!authenticated) {
      Alert.alert(t("session.alerts.authRequiredTitle"), t("session.alerts.authRequiredMessage"))
      return
    }

    const text = input.trim()
    const files = [...attachments]
    setInput("")
    setAttachments([])
    // Sending is an explicit "jump to the answer" — even if the user had
    // scrolled up to read history.
    scrollToBottom(true)

    // Server slash commands (no attachments for commands)
    if (text.startsWith("/") && files.length === 0) {
      const [cmdName, ...args] = text.split(" ")
      const name = cmdName.slice(1)
      // Builtins (new/model/agent/compact/undo/redo) never go to the server
      // as text — run them locally like the slash popover does.
      if (BUILTIN_COMMANDS.some((c) => c.trigger === name)) {
        if (runBuiltin(name)) return
      }
      const match = serverCommands.find((c) => c.name === name)
      if (match && sessionClient && currentSession) {
        sessionClient.session
          .command(currentSession.id, {
            command: name,
            arguments: args.join(" "),
            agent,
            model: model ? `${model.providerID}/${model.modelID}` : undefined,
          })
          .catch((err) => console.error("Command failed:", err))
        return
      }
    }

    // Messages are queued server-side when the session is busy.
    // No need to abort - just send and it will be processed after current response.
    try {
      await sendMessage(text, model || undefined, agent || undefined, files, variant || undefined)
    } catch (err) {
      console.error("Send failed:", err)
      // Restore the user's text and attachments so their input isn't lost.
      setInput((prev) => (prev ? prev : text))
      setAttachments((prev) => (prev.length ? prev : files))
      Alert.alert(t("session.alerts.sendFailedTitle"), t("session.alerts.sendFailedMessage"))
    }
  }

  // In inverted mode, offset 0 = bottom. Show scroll button when scrolled away from bottom.
  const handleScroll = useCallback((event: any) => {
    const { contentOffset } = event.nativeEvent
    followBottomRef.current = shouldFollowBottom(contentOffset.y)
    setShowScrollButton(contentOffset.y > 200)
  }, [])

  // Debounce: onEndReached can fire multiple times during a single scroll gesture
  const loadingTriggered = useRef(false)
  const handleLoadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loadingTriggered.current) {
      loadingTriggered.current = true
      loadOlderMessages()
    }
  }, [hasMore, loadingMore, loadOlderMessages])

  // Reset trigger when loading finishes
  useEffect(() => {
    if (!loadingMore) loadingTriggered.current = false
  }, [loadingMore])

  // Detect reconnecting → stable transition for the "Connected ✓" flash.
  // reconnectAttempts and lastDisconnectAt reset in the same set() call, so we
  // can't use lastDisconnectAt alone; a useRef tracks the prior reconnecting state.
  useEffect(() => {
    const isReconnecting = reconnectAttempts > 0
    // BUG-013: only flash "Connected" when actually connected — events.ts
    // disconnect() resets reconnectAttempts to 0, which previously caused the
    // banner to flash on disconnect.
    if (prevReconnecting.current && !isReconnecting && connected) {
      setShowConnectedFlash(true)
      const t = setTimeout(() => setShowConnectedFlash(false), 2000)
      return () => clearTimeout(t)
    }
    prevReconnecting.current = isReconnecting
  }, [reconnectAttempts, connected])

  const handlePermissionReply = async (requestID: string, reply: "once" | "always" | "reject") => {
    if (!sessionClient || !sessionID) return
    // Snapshot for rollback
    const snapshot = useEvents.getState().permissions[sessionID] || []
    // Optimistically remove from UI
    useEvents.setState((state) => ({
      permissions: {
        ...state.permissions,
        [sessionID]: snapshot.filter((p) => p.id !== requestID),
      },
    }))
    try {
      await sessionClient.permission.reply(sessionID, requestID, reply)
    } catch (err) {
      console.error("Permission reply failed:", err)
      // Restore the prompt so the user can retry
      useEvents.setState((state) => ({
        permissions: { ...state.permissions, [sessionID]: snapshot },
      }))
      Alert.alert(t("session.alerts.replyFailedTitle"), t("session.alerts.replyFailedMessage"))
    }
  }

  const handleQuestionReply = async (requestID: string, answers: string[][]) => {
    if (!sessionClient || !sessionID) throw new Error("No active session")

    // The prompt stays mounted while the reply is in flight, so a failure can
    // re-enable retry; on success its place is taken by the answered card.
    try {
      await sessionClient.question.reply(sessionID, requestID, answers)
    } catch (err) {
      console.error("Question reply failed:", err)
      Alert.alert(t("session.alerts.replyFailedTitle"), t("session.alerts.replyFailedMessage"))
      throw err
    }

    // Keep the answered question in the transcript. The server drops the form
    // as soon as the reply lands and the prompt disappears with it; the card
    // used to survive as a 2.5s echo only, so a minute later the user could no
    // longer check what they had picked.
    const request = (useEvents.getState().questions[sessionID] || []).find((q) => q.id === requestID)
    if (!request) return
    useEvents.getState().recordQuestionAnswer(sessionID, request, answers)
    useEvents.setState((state) => ({
      questions: {
        ...state.questions,
        [sessionID]: (state.questions[sessionID] || []).filter((q) => q.id !== requestID),
      },
    }))
  }

  const handleQuestionReject = async (requestID: string) => {
    if (!sessionClient || !sessionID) throw new Error("No active session")
    try {
      await sessionClient.question.reject(sessionID, requestID)
    } catch (err) {
      console.error("Question reject failed:", err)
      Alert.alert(t("session.alerts.rejectFailedTitle"), t("session.alerts.rejectFailedMessage"))
      throw err
    }
    const request = (useEvents.getState().questions[sessionID] || []).find((q) => q.id === requestID)
    if (request) useEvents.getState().recordQuestionAnswer(sessionID, request, [])
    useEvents.setState((state) => ({
      questions: {
        ...state.questions,
        [sessionID]: (state.questions[sessionID] || []).filter((q) => q.id !== requestID),
      },
    }))
  }

  const handleModelSelect = useCallback(
    (providerID: string, modelID: string) => {
      setModel({ providerID, modelID })
    },
    [setModel],
  )

  // Current agent display (state stores the API id; `name` is display case)
  const currentAgent = agents.find((a) => (a.id ?? a.name) === agent || a.name === agent)
  const agentColor = currentAgent?.color || "#8b5cf6"
  const modelLabel = model?.modelID ? model.modelID.split("/").pop() || model.modelID : "default"

  // Variants for current model (for reasoning effort picker)
  const currentModelVariants = useMemo(() => {
    if (!model) return undefined
    const provider = providers.find((p) => p.id === model.providerID)
    const found = provider?.models.find((m) => m.id === model.modelID)
    return found?.variants
  }, [model, providers])

  // Same numbers as the info panel (session-stats.ts), so the ring and the
  // percentage in the panel can never disagree.
  const contextPercent = useMemo(
    () => computeSessionStats(messages || [], providers, currentSession).percent,
    [messages, providers, currentSession],
  )

  const navigation = useNavigation()

  // Header options are set through an effect, not inline on the Stack.Screen
  // element: this screen re-renders on every streamed part, and inline options
  // re-registered the native header on each render — the race behind the
  // react-native-screens "child already has a parent" crash when leaving a
  // session mid-stream (upstream v0.4.17, Sentry OPENCODE-MOBILE-6/-7).
  // contextPercent is in the deps so the ring still updates, but only when the
  // visible data changes.
  useEffect(() => {
    navigation.setOptions({
      title: currentSession?.title || t("session.titleFallback"),
      headerRight: () => (
        <View style={s.headerRight}>
          {shortDir && (
            <View style={[s.dirBadge, isDark && s.dirBadgeDark]}>
              <Ionicons name="folder-outline" size={14} color={isDark ? "#888888" : "#666666"} />
              <Text style={[s.dirText, isDark && s.dirTextDark]}>{shortDir}</Text>
            </View>
          )}
          <ContextRing
            percent={contextPercent}
            isDark={isDark}
            active={showInfo}
            onPress={() => setShowInfo((v) => !v)}
            accessibilityLabel={t("chat.sessionInfo.open")}
          />
        </View>
      ),
    })
  }, [navigation, currentSession?.title, shortDir, showInfo, isDark, t, contextPercent])

  return (
    <>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
      {layout.split && <TabletSessions width={layout.sidebar} selected={id} />}
      <View
        style={[
          s.container,
          { maxWidth: layout.content },
          isDark && s.containerDark,
          // No keyboard padding here: MainActivity already shrinks the whole
          // root view under the IME inset. Padding the container on top of that
          // only moved the list, leaving the screen's own bottom edge (and the
          // composer with it) partly under the keyboard.
        ]}
      >
        {/* Session info pulldown */}
        <SessionInfo
          session={currentSession}
          messages={messages || []}
          providers={providers}
          visible={showInfo}
          isDark={isDark}
          hasMore={hasMore}
          loadingAll={loadingMore}
          onLoadAll={() => {
            if (hasMore && !loadingMore) loadOlderMessages()
          }}
          onScrollToTop={() => {
            flatListRef.current?.scrollToEnd({ animated: true })
          }}
          onClose={() => setShowInfo(false)}
        />

        {/* SSE reconnect/connected banner */}
        {reconnectAttempts > 0 && (
          <View style={[s.banner, s.bannerReconnecting]}>
            <Text style={s.bannerText}>{t("session.banners.reconnecting", { attempt: reconnectAttempts })}</Text>
          </View>
        )}
        {showConnectedFlash && reconnectAttempts === 0 && (
          <View style={[s.banner, s.bannerConnected]}>
            <Text style={s.bannerText}>{t("session.banners.connected")}</Text>
          </View>
        )}

        {/* Pending revert (from "Edit message") — offer a way back before it's
            cleaned up by the next prompt. */}
        {revertMessageID && (
          <View style={[s.banner, s.bannerRevert]}>
            <Text style={s.bannerText}>{t("session.banners.reverted")}</Text>
            <TouchableOpacity
              onPress={() => {
                unrevertSession()
                // The composer was prefilled with the reverted message's text/
                // attachments (see applyRevertResult) — clear it so Undo doesn't
                // leave a stale draft that could be sent as a duplicate.
                setInput("")
                setAttachments([])
              }}
              hitSlop={8}
            >
              <Text style={s.bannerAction}>{t("session.banners.undo")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {isLoading ? (
          <View style={s.loading}>
            <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
          </View>
        ) : (
          <View style={s.listWrap}>
            <FlatList
              ref={flatListRef}
              data={messageData}
              inverted
              keyExtractor={(item) => item.message.id}
              renderItem={({ item, index }) => (
                <MessageBubble
                  message={item.message}
                  parts={item.parts}
                  isDark={isDark}
                  continued={flags[index]?.continued}
                  showMeta={flags[index]?.showMeta}
                  totals={totals[index]}
                  onLongPress={handleMessageLongPress}
                  onRevert={handleMessageRevert}
                />
              )}
              contentContainerStyle={s.messageList}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              // Follow streaming output and new messages while the user is at
              // the bottom. maintainVisibleContentPosition is deliberately not
              // set: on an inverted list it pins the previously visible row, so
              // each new assistant message would push itself out of view.
              onContentSizeChange={() => {
                if (followBottomRef.current) flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
              }}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                loadingMore ? (
                  <View style={s.loadingMore}>
                    <ActivityIndicator size="small" color={isDark ? "#888888" : "#666666"} />
                    <Text style={[s.loadingMoreText, isDark && s.metaDark]}>{t("session.loadingOlder")}</Text>
                  </View>
                ) : undefined
              }
            />
            {/* Empty state rendered OUTSIDE the inverted list to avoid the
                inverted transform mirroring its text/icon (see #ui-mirror). */}
            {messageData.length === 0 && (
              <View style={s.emptyOverlay} pointerEvents="none">
                <Ionicons name="chatbubble-outline" size={48} color={isDark ? "#444444" : "#cccccc"} />
                <Text style={[s.emptyText, isDark && s.metaDark]}>{t("session.empty.title")}</Text>
                <Text style={[s.emptyHint, isDark && s.metaDark]}>{t("session.empty.hint")}</Text>
              </View>
            )}
            {showScrollButton && (
              <TouchableOpacity style={[s.scrollBtn, isDark && s.scrollBtnDark]} onPress={() => scrollToBottom(true)}>
                <Ionicons name="chevron-down" size={24} color={isDark ? "#ffffff" : "#0a0a0a"} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Status */}
        {currentSession && <StatusIndicator sessionID={currentSession.id} isDark={isDark} />}

        {/* Permissions */}
        {/* Prompts: permissions, reply confirmation, questions.
            Scrollable and shrinkable on purpose. The message list above is
            `flex: 1` and collapses to nothing, so a fixed-height question card
            used to push the composer below the screen as soon as the keyboard
            opened — typing in the chat was blind. Here the card scrolls inside
            the space that is left, and the composer below always stays visible.
            `handled` keeps option taps working while the keyboard is up
            (without it the first tap only dismisses the keyboard). */}
        <ScrollView
          style={s.promptArea}
          keyboardShouldPersistTaps="handled"
        >
          {permissions.map((perm) => (
            <PermissionPrompt
              key={perm.id}
              permission={perm}
              isDark={isDark}
              onReply={(reply) => handlePermissionReply(perm.id, reply)}
            />
          ))}

          {/* Answered questions stay in place — the user can re-read what
              they picked at any point in the run, not for 2.5 seconds. */}
          {answeredQuestions.map((item) => (
            <AnsweredQuestionCard
              key={item.request.id}
              request={item.request}
              answers={item.answers}
              isDark={isDark}
            />
          ))}

          {questions.map((q) => (
            <QuestionPrompt
              key={q.id}
              request={q}
              isDark={isDark}
              onReply={(answers) => handleQuestionReply(q.id, answers)}
              onReject={() => handleQuestionReject(q.id)}
            />
          ))}
        </ScrollView>

        {/* Slash popover */}
        {slashActive && (
          <SlashPopover query={slashQuery} commands={allCommands} isDark={isDark} onSelect={handleSlashSelect} />
        )}

        {/* Agent/model toolbar */}
        <View style={[s.toolbar, isDark && s.toolbarDark]}>
          <TouchableOpacity
            style={[s.agentChip, { borderColor: agentColor }]}
            onPress={() => cycleAgent()}
            onLongPress={() => cycleAgent(-1)}
          >
            <View style={[s.agentDot, { backgroundColor: agentColor }]} />
            <Text style={[s.agentLabel, isDark && s.textWhite]}>{(currentAgent?.name ?? agent) || "build"}</Text>
            <Ionicons name="swap-horizontal-outline" size={12} color={isDark ? "#888888" : "#666666"} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modelChip, isDark && s.modelChipDark]}
            onPress={openModelPicker}
            testID="model-chip"
          >
            <Ionicons name="hardware-chip-outline" size={14} color={isDark ? "#888888" : "#666666"} />
            <Text style={[s.modelLabel, isDark && s.metaDark]} numberOfLines={1}>
              {modelLabel}
            </Text>
          </TouchableOpacity>

          {currentModelVariants && Object.keys(currentModelVariants).length > 0 && (
            <TouchableOpacity
              style={[s.variantChip, isDark && s.variantChipDark, variant && s.variantChipActive]}
              onPress={() => {
                // The picker has no text input, so the keyboard is pure
                // obstruction: with it up the sheet rendered behind the IME
                // and the last option ("High") was unreachable.
                Keyboard.dismiss()
                variantSheetRef.current?.expand()
              }}
              testID="variant-chip"
            >
              <Ionicons name="flash-outline" size={14} color={variant ? "#8b5cf6" : isDark ? "#888888" : "#666666"} />
              <Text style={[s.variantLabel, isDark && s.metaDark, variant && s.variantLabelActive]} numberOfLines={1}>
                {variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : t("session.toolbar.auto")}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Attachment preview */}
        <ImageAttachments attachments={attachments} isDark={isDark} onRemove={removeAttachment} />

        {/* Input */}
        <View
          style={[
            s.inputContainer,
            isDark && s.inputContainerDark,
            // While the keyboard is open the gesture-nav inset is covered by
            // it — keep only the base 12px gap instead of stacking it on top
            // of the keyboard-height container padding.
            kbHeight > 0
              ? { paddingBottom: 12 }
              : { paddingBottom: Math.max(12, insets.bottom) },
          ]}
        >
          <View style={s.inputRow}>
            {/* Attach button */}
            <TouchableOpacity style={s.attachBtn} onPress={pickFromLibrary} onLongPress={pickFromCamera} testID="attach-button">
              <Ionicons name="add-circle-outline" size={26} color={isDark ? "#888888" : "#666666"} />
            </TouchableOpacity>

            {/* Clipboard paste button */}
            <TouchableOpacity style={s.attachBtn} onPress={pasteFromClipboard}>
              <Ionicons name="clipboard-outline" size={22} color={isDark ? "#888888" : "#666666"} />
            </TouchableOpacity>

            <TextInput
              style={[s.input, isDark && s.inputDark, speech.listening && s.inputListening]}
              placeholder={
                speech.listening
                  ? t("session.input.placeholderListening")
                  : isSending
                    ? t("session.input.placeholderFollowUp")
                    : t("session.input.placeholderDefault")
              }
              placeholderTextColor={speech.listening ? "#ef4444" : isDark ? "#666666" : "#999999"}
              value={speech.listening ? speech.transcript : input}
              onChangeText={speech.listening ? undefined : setInput}
              editable={!speech.listening}
              multiline
              maxLength={10000}
              testID="chat-message-input"
            />
            {/* Stop button: when busy — regardless of input, so a follow-up
                typed mid-run can still be aborted (BUG-022). `sessionBusy` is
                the server's status, so a run that this screen did not start
                (opened mid-run, app restarted, SSE reconnected while it kept
                going) can be interrupted too; before, only the optimistic
                send flag showed the button, and a long tool call running
                server-side had no way to be stopped. */}
            {canStop && !speech.listening && (
              <TouchableOpacity style={s.stopBtn} onPress={handleAbort} testID="chat-stop-button">
                <Ionicons name="stop" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}
            {/* Mic button: when no input, not sending, and not listening */}
            {!isSending && !input.trim() && attachments.length === 0 && !speech.listening && (
              <TouchableOpacity style={s.micBtn} onPress={speech.start}>
                <Ionicons name="mic" size={22} color={isDark ? "#888888" : "#666666"} />
              </TouchableOpacity>
            )}
            {/* Listening indicator: tap to stop */}
            {speech.listening && (
              <TouchableOpacity style={s.micBtnActive} onPress={speech.stop}>
                <Ionicons name="mic" size={22} color="#ffffff" />
              </TouchableOpacity>
            )}
            {/* Send button: when there's input */}
            {!speech.listening && (input.trim() || attachments.length > 0) && (
              <TouchableOpacity style={s.sendBtn} onPress={handleSend} testID="chat-send-button">
                <Ionicons name="send" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Model picker bottom sheet */}
      <ModelPicker
        sheetRef={modelSheetRef}
        providers={providers}
        selected={model}
        isDark={isDark}
        onSelect={handleModelSelect}
        onManageModels={() => router.push("/models")}
      />

      {/* Reasoning effort (variant) picker bottom sheet */}
      <VariantPicker
        sheetRef={variantSheetRef}
        variants={currentModelVariants}
        selected={variant}
        isDark={isDark}
        onSelect={setVariant}
      />
      </View>
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  listWrap: { flex: 1, position: "relative" },
  // ScrollView defaults to flexGrow: 1 (RN's baseVertical), which would let an
  // empty prompt area eat the free space and push the message list up. Grow
  // never, shrink only when the prompts do not fit.
  promptArea: { flexGrow: 0, flexShrink: 1 },

  // Messages
  messageList: { padding: 16, paddingBottom: 8 },

  // Scroll button
  scrollBtn: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  scrollBtnDark: { backgroundColor: "#2a2a2a" },

  // Loading more (appears at top in inverted list = ListFooterComponent)
  loadingMore: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  loadingMoreText: { fontSize: 13, color: "#999999" },

  // Empty state overlay — sits on top of the (empty) inverted list, untransformed,
  // so its text/icon render upright and un-mirrored on Android.
  emptyOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 64,
  },

  // Empty
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 64 },
  emptyText: { fontSize: 16, color: "#999999", marginTop: 12 },
  emptyHint: { fontSize: 13, color: "#bbbbbb", marginTop: 4 },
  metaDark: { color: "#666666" },
  textWhite: { color: "#ffffff" },

  // Answered questions are rendered by AnsweredQuestionCard (see
  // components/chat/AnsweredQuestion.tsx) — no floating echo anymore.

  // Toolbar
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  toolbarDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  agentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  agentDot: { width: 8, height: 8, borderRadius: 4 },
  agentLabel: { fontSize: 12, fontWeight: "600", color: "#0a0a0a" },
  modelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modelChipDark: { backgroundColor: "#1a1a1a" },
  modelLabel: { fontSize: 12, color: "#666666", maxWidth: 160 },

  // Variant (reasoning effort) chip
  variantChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  variantChipDark: { backgroundColor: "#1a1a1a" },
  variantChipActive: { backgroundColor: "#f5f3ff" },
  variantLabel: { fontSize: 12, color: "#666666" },
  variantLabelActive: { color: "#8b5cf6" },

  // Input
  inputContainer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  inputContainerDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  attachBtn: {
    width: 36,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
    color: "#0a0a0a",
  },
  inputDark: { backgroundColor: "#1a1a1a", color: "#ffffff" },
  inputListening: { borderWidth: 1, borderColor: "#ef4444" },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: "#cccccc" },
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  micBtnActive: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  // Header
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  dirBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dirBadgeDark: { backgroundColor: "#1a1a1a" },
  dirText: { fontSize: 12, color: "#666666", fontWeight: "500" },
  dirTextDark: { color: "#888888" },

  // SSE reconnect/connected banner
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignItems: "center",
  },
  bannerReconnecting: { backgroundColor: "#92400e" },
  bannerConnected: { backgroundColor: "#065f46" },
  bannerText: { color: "#ffffff", fontSize: 13, fontWeight: "500", flexShrink: 1 },

  // Pending revert (edit message) banner
  bannerRevert: {
    backgroundColor: "#1e3a8a",
    flexDirection: "row",
    justifyContent: "space-between",
    // The reverted message text is user-length (campaigns of paragraphs);
    // the gap keeps "Undo" readable once the text wraps instead of pushing
    // it past the screen edge.
    gap: 12,
  },
  bannerAction: { color: "#93c5fd", fontSize: 13, fontWeight: "700" },
})
