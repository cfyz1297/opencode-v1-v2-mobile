import { useCallback, useEffect, useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from "@gorhom/bottom-sheet"
import { useTranslation } from "react-i18next"

interface Props {
  sheetRef: React.RefObject<BottomSheet | null>
  isDark: boolean
  onCamera: () => void
  onPhoto: () => void
  onFile: () => void
}

// The attach menu: one sheet with a row per source, the way the native OpenCode
// client does it. It replaced an Alert, which could only offer text buttons —
// no icons, and Android renders it in the system style, not the app's.
export function AttachMenuSheet({ sheetRef, isDark, onCamera, onPhoto, onFile }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // The Alert was cancelable, so Back used to dismiss the menu. A sheet is a
  // plain view, and without this Back leaves the whole session instead.
  useEffect(() => {
    if (!open) return
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      sheetRef.current?.close()
      return true
    })
    return () => subscription.remove()
  }, [open, sheetRef])

  // Close first, then open the picker: the picker is a separate activity and
  // would otherwise appear behind a sheet that is still on screen.
  const pick = (openPicker: () => void) => () => {
    sheetRef.current?.close()
    openPicker()
  }

  const rows = [
    { key: "camera", icon: "camera-outline", label: t("session.attach.camera"), onPress: pick(onCamera) },
    { key: "photo", icon: "image-outline", label: t("session.attach.photo"), onPress: pick(onPhoto) },
    { key: "file", icon: "folder-outline", label: t("session.attach.file"), onPress: pick(onFile) },
  ] as const

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      // The second detent exists for a large system font, where three rows no
      // longer fit the compact one.
      snapPoints={["33%", "55%"]}
      // See DirectoryBrowserSheet.tsx for why this is required alongside
      // static snapPoints (issue #104): without it the sheet can never open.
      enableDynamicSizing={false}
      enablePanDownToClose
      // The library marks the content container accessible by default, which
      // on iOS turns the sheet into one "Bottom Sheet, adjustable" element and
      // hides the rows from the screen reader.
      accessible={false}
      onChange={useCallback((index: number) => setOpen(index >= 0), [])}
      backgroundStyle={isDark ? s.sheetDark : s.sheet}
      handleIndicatorStyle={{ backgroundColor: isDark ? "#666666" : "#cccccc" }}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
      )}
    >
      <BottomSheetView>
        {rows.map((row) => (
          <TouchableOpacity
            key={row.key}
            style={s.row}
            onPress={row.onPress}
            activeOpacity={0.6}
            accessibilityRole="button"
            testID={`attach-${row.key}`}
          >
            <Ionicons name={row.icon} size={24} color={isDark ? "#d4d4d8" : "#52525b"} />
            <Text style={[s.label, isDark && s.textWhite]}>{row.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={s.bottomSpace} />
      </BottomSheetView>
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  sheet: { backgroundColor: "#ffffff" },
  sheetDark: { backgroundColor: "#1a1a1a" },
  textWhite: { color: "#ffffff" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  label: { fontSize: 17, color: "#0a0a0a" },
  bottomSpace: { height: 24 },
})
