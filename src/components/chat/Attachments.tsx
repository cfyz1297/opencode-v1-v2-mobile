import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { isImageMime } from "../../lib/file-attachment"

export interface Attachment {
  uri: string
  mime: string
  filename?: string
  width?: number
  height?: number
  base64?: string
}

interface Props {
  attachments: Attachment[]
  isDark: boolean
  onRemove: (index: number) => void
}

// Composer preview of what will be sent. Images keep their thumbnail; any
// other file has no picture to show, so it becomes a document tile.
export function Attachments({ attachments, isDark, onRemove }: Props) {
  if (attachments.length === 0) return null

  return (
    <View style={[s.container, isDark && s.containerDark]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {attachments.map((att, idx) => (
          <View key={`${att.uri}-${idx}`} style={s.thumb}>
            {isImageMime(att.mime) ? (
              <Image source={{ uri: att.uri }} style={s.image} resizeMode="cover" />
            ) : (
              <View style={[s.file, isDark && s.fileDark]}>
                <Ionicons name="document-text-outline" size={26} color={isDark ? "#a78bfa" : "#6d28d9"} />
              </View>
            )}
            <TouchableOpacity style={[s.remove, isDark && s.removeDark]} onPress={() => onRemove(idx)}>
              <Ionicons name="close" size={14} color="#ffffff" />
            </TouchableOpacity>
            {att.filename && (
              <Text style={[s.label, isDark && s.labelDark]} numberOfLines={1}>
                {att.filename}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  containerDark: { backgroundColor: "#0a0a0a", borderTopColor: "#1a1a1a" },
  scroll: { gap: 8 },
  thumb: { position: "relative" },
  image: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  file: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#f5f3ff",
    justifyContent: "center",
    alignItems: "center",
  },
  fileDark: { backgroundColor: "#241b3a" },
  remove: {
    position: "absolute",
    // Inside the thumbnail: the ScrollView clips its content, so the old
    // -6/-6 offset cut the top and right of the badge off.
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  removeDark: { backgroundColor: "#ef4444", borderColor: "#0a0a0a" },
  label: {
    fontSize: 10,
    color: "#666666",
    marginTop: 2,
    maxWidth: 72,
    textAlign: "center",
  },
  labelDark: { color: "#888888" },
})
