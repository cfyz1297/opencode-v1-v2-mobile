import { useMemo, type ReactNode } from "react"
import {
  View,
  Text,
  useColorScheme,
  Platform,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native"
import { useMarkdown, Renderer } from "react-native-marked"
import { CodeBlock } from "./CodeBlock"
import { MarkdownImage } from "./MarkdownImage"
import { openLink } from "./open-link"
import { LINK_COLOR } from "./link-color"
import { createMarkdownKeys } from "../../lib/markdown-keys"
import { extractSingleUrl, splitTextWithUrls } from "../../lib/linkify"
import i18n from "../../lib/i18n/config"

// react-native-marked's base Renderer hardcodes `selectable` on every plain
// text node it produces (text/strong/em/del/heading/codespan). That was removed
// here while the chat bubbles were wrapped in a TouchableOpacity: on Android the
// touch wrapper wins the long-press, so `selectable` text inside it could never
// be selected — the flag was dead weight and only fed the accessibility tree.
// Assistant bubbles are a plain View now (see MessageBubble), so selection works
// again and the flag is back on every text node — except a node that wraps a
// link: selectable text handles the touch itself and the nested link's press
// never fires, so such a node opts out (bold/italic/heading contain links).
// True when any child (at any depth) is one of this renderer's link nodes.
// They are the only nodes here with role "link", and a selectable ancestor
// would swallow their press on Android.
function hasLink(children: string | ReactNode[]): boolean {
  if (typeof children === "string") return false
  return children
    .flat(Infinity)
    .some((child) => typeof child === "object" && child !== null && (child as { props?: { accessibilityRole?: string } }).props?.accessibilityRole === "link")
}

export class CustomRenderer extends Renderer {
  // Every Text node carries the paragraph's own font metrics, including the
  // wrapper the parser builds around a paragraph's inline runs
  // (getNormalizedSiblingNodesForBlockAndInlineTokens calls text(nodes, {})).
  // Without them that wrapper is laid out at the platform default font while
  // its children use fontSize 15, so the wrapper's metrics decide the box the
  // runs are painted into.
  constructor(
    private readonly base: TextStyle,
    private readonly linkStyle?: TextStyle,
  ) {
    super()
  }

  // The base Renderer derives every React key from github-slugger, which stores
  // a property per call on an instance that outlives re-renders — the Hermes
  // object limit (196,607 properties) then throws "Property storage exceeds
  // 196607 properties" and the session screen dies. Keys only have to be
  // unique within one parse, so a counter does that with no storage at all.
  // Every base method asks getKey(), so this one override covers them all.
  private readonly key = createMarkdownKeys()

  getKey(): string {
    return this.key()
  }

  private plainText(children: string | ReactNode[], styles?: StyleProp<TextStyle>): ReactNode {
    return (
      <Text key={this.getKey()} style={[this.base, styles]} selectable={!hasLink(children)}>
        {children}
      </Text>
    )
  }

  code(text: string, language?: string, containerStyle?: ViewStyle, _textStyle?: TextStyle) {
    return (
      <View key={this.getKey()} style={containerStyle}>
        <CodeBlock code={text} language={language} />
      </View>
    )
  }

  text(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    // A bare URL GFM autolink missed (no scheme, trailing punctuation) arrives
    // here as a raw string: split it into link nodes. The parser also calls
    // text() with an already-rendered array (the paragraph wrapper) — its link
    // tokens are already link nodes, so pass that through untouched.
    if (typeof text !== "string") return this.plainText(text, styles)
    const segments = splitTextWithUrls(text)
    if (!segments.some((segment) => segment.url)) return this.plainText(text, styles)
    return segments.map((segment) =>
      segment.url
        ? this.link(segment.text, segment.url, [this.base, styles, this.linkStyle])
        : this.plainText(segment.text, styles),
    )
  }

  // Own link handling instead of the library default (upstream #284). The
  // default is a `selectable` Text; selectable text inside a FlatList row
  // swallows the press on Android (RN#46999, see the header comment), so a
  // link was highlighted but never opened. Presses go through openLink, which
  // offers Copy when nothing can open the URL.
  link(children: string | ReactNode[], href: string, styles?: StyleProp<TextStyle>, _title?: string): ReactNode {
    return (
      <Text
        key={this.getKey()}
        style={styles}
        accessibilityRole="link"
        accessibilityHint={i18n.t("chat.link.hint")}
        onPress={() => openLink(href)}
      >
        {children}
      </Text>
    )
  }

  strong(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(children, styles)
  }

  em(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(children, styles)
  }

  del(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(children, styles)
  }

  heading(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(text, styles)
  }

  codespan(text: string, styles?: TextStyle): ReactNode {
    // A URL in backticks lexes as a codespan, not a link — agents write them
    // constantly. A span that IS one URL renders as a link; anything else keeps
    // the code styling and stays inert, and fenced blocks (code()) are untouched.
    const url = extractSingleUrl(text)
    if (url) return this.link(text, url, [this.base, styles, { fontStyle: "normal", fontWeight: "normal" }, this.linkStyle])
    return this.plainText(text, [styles, { fontStyle: "normal", fontWeight: "normal" }])
  }

  image(uri: string, alt?: string, style?: ImageStyle, title?: string): ReactNode {
    // .svg keeps the library's component: its fetch effect is already scoped to
    // the URI. Everything else must not use MDImage, whose effect has no
    // dependency array and refetches on every render (issue #262).
    if (uri.endsWith(".svg")) return super.image(uri, alt, style, title)
    return <MarkdownImage key={this.getKey()} uri={uri} alt={alt || title} style={style} />
  }
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

const lightTheme = {
  // No lineHeight anywhere in this theme. React Native implements lineHeight
  // with CustomLineHeightSpan, whose chooseHeight() sets the last line's box to
  // fm.bottom = fm.descent. A font that reports a shallower descent than its
  // glyphs — any font but Roboto, i.e. a themed device font — then has the
  // bottom of a paragraph's last line cut off, while interior lines only
  // overlap and look fine. Letting Android derive the line box from the real
  // font metrics is the only device-independent option.
  text: { color: "#0a0a0a", fontSize: 15 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  h1: { fontSize: 22, fontWeight: "700" as const, color: "#0a0a0a", marginBottom: 8, marginTop: 12 },
  h2: { fontSize: 19, fontWeight: "600" as const, color: "#0a0a0a", marginBottom: 6, marginTop: 10 },
  h3: { fontSize: 16, fontWeight: "600" as const, color: "#0a0a0a", marginBottom: 4, marginTop: 8 },
  link: { color: LINK_COLOR.light },
  blockquote: {
    backgroundColor: "transparent",
    borderLeftWidth: 3,
    borderLeftColor: "#d1d5db",
    paddingLeft: 12,
    paddingVertical: 2,
    marginVertical: 4,
  },
  code: {
    backgroundColor: "#e8e5f0",
    color: "#6d28d9",
    fontFamily: mono,
    fontSize: 13,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  codespan: {
    color: "#6d28d9",
    // No pill. Android draws an inline background from the span's own box, and
    // for a wrapped span that box is taller than the line: the bar of
    // `pi-extension/` starts above the previous line and covers the letters
    // there, while a smaller code font shifts it about half a line down. Two
    // emulator runs (in inherited-metrics and explicit-metrics variants) both
    // reproduce it, so the highlight itself is what corrupts chat — the glyphs
    // are fine. Inline code is marked by colour and monospace instead.
    //
    // `transparent` rather than omitting the key: react-native-marked's own
    // codespan style carries a background, and only an explicit value
    // overrides it. bgColor 0 makes Android paint no rectangle at all.
    // fontSize must stay inherited too (a nested Text that declares its own
    // metrics shifts the box as well).
    backgroundColor: "transparent",
    fontFamily: mono,
  },
  list: { marginBottom: 4 },
  li: { marginBottom: 2 },
  hr: { backgroundColor: "#e5e5e5", height: 1, marginVertical: 12 },
  strong: { fontWeight: "700" as const },
  em: { fontStyle: "italic" as const },
  strikethrough: { textDecorationLine: "line-through" as const },
  image: { borderRadius: 8 },
}

const darkTheme = {
  ...lightTheme,
  text: { ...lightTheme.text, color: "#e5e5e5" },
  h1: { ...lightTheme.h1, color: "#ffffff" },
  h2: { ...lightTheme.h2, color: "#ffffff" },
  h3: { ...lightTheme.h3, color: "#ffffff" },
  link: { color: LINK_COLOR.dark },
  blockquote: {
    ...lightTheme.blockquote,
    borderLeftColor: "#4a4a5a",
  },
  code: {
    ...lightTheme.code,
    backgroundColor: "#2a2040",
    color: "#c4b5fd",
  },
  codespan: {
    ...lightTheme.codespan,
    color: "#c4b5fd",
  },
  hr: { ...lightTheme.hr, backgroundColor: "#2a2a2a" },
}

interface Props {
  children: string
}

export function Markdown({ children }: Props) {
  const isDark = useColorScheme() === "dark"
  const theme = isDark ? darkTheme : lightTheme

  // A module-scope singleton renderer would share one CustomRenderer (and
  // its underlying github-slugger) across every Markdown instance and every
  // streamed token forever. github-slugger never resets, so its heading-slug
  // keys only ever climb — which fed into useMarkdown's memoized parser and
  // made the emitted React keys change on every token, remounting the whole
  // subtree (resetting code-block scroll position, flashing content). Scoping
  // the renderer to `children` resets the slugger per parse, so keys are
  // deterministic (and stable) for a given value, while re-renders with an
  // unchanged value stay memoized instead of creating a new renderer.
  const renderer = useMemo(() => new CustomRenderer(theme.text, theme.link), [children, theme])

  // react-native-marked's default <RNMarkdown> export renders blocks inside a
  // FlatList. Chat messages are rendered inside app/session/[id].tsx's own
  // FlatList (each row a MessageBubble) — nesting one
  // VirtualizedList inside another is a known
  // React Native footgun where the inner list's content can fail to lay out
  // (renders zero height) instead of just warning. We already force
  // scrollEnabled: false and a large initialNumToRender here, which defeats
  // virtualization anyway, so there's nothing to lose by rendering the parsed
  // blocks directly with the useMarkdown hook instead (issue #104).
  const elements = useMarkdown(children ?? "", {
    renderer,
    styles: theme,
    colorScheme: isDark ? "dark" : "light",
  })

  if (!children?.trim()) return null

  return <View style={{ backgroundColor: "transparent" }}>{elements}</View>
}
