import { Text, type StyleProp, type TextStyle } from "react-native"
import { splitTextWithUrls } from "../../lib/linkify"
import { openLink } from "./open-link"
import { LINK_COLOR } from "./link-color"
import i18n from "../../lib/i18n/config"

interface Props {
  text: string
  style?: StyleProp<TextStyle>
  selectable?: boolean
  isDark?: boolean
}

// Plain-text surfaces (user messages) have no markdown pass, so a bare URL in
// them used to be inert (upstream #284). Same link treatment as Markdown.
//
// selectable is dropped when the text holds a link: on Android a selectable
// Text handles the touch itself and the nested link never opens. Text without
// links keeps selection, which is the common case.
export function LinkifiedText({ text, style, selectable, isDark }: Props) {
  const segments = splitTextWithUrls(text)
  if (!segments.some((segment) => segment.url)) {
    return (
      <Text style={style} selectable={selectable}>
        {text}
      </Text>
    )
  }
  return (
    <Text style={style}>
      {segments.map((segment, index) => {
        if (!segment.url) return <Text key={index}>{segment.text}</Text>
        const url = segment.url
        return (
          <Text
            key={index}
            style={{ color: isDark ? LINK_COLOR.dark : LINK_COLOR.light }}
            accessibilityRole="link"
            accessibilityHint={i18n.t("chat.link.hint")}
            onPress={() => openLink(url)}
          >
            {segment.text}
          </Text>
        )
      })}
    </Text>
  )
}
