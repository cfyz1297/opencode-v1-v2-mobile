import { useCallback } from "react"
import { View, Text, TouchableOpacity, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import BottomSheet, { BottomSheetBackdrop, BottomSheetSectionList, BottomSheetTextInput } from "@gorhom/bottom-sheet"
import { useTranslation } from "react-i18next"
import type { ModelPickerItem } from "../../lib/model-picker-filter"
import { ModelPickerRow, pickerStyles as p, useModelPickerData, type ModelPickerProvider } from "./model-picker-shared"

interface Props {
  providers: ModelPickerProvider[]
  selected: { providerID: string; modelID: string } | null
  isDark: boolean
  onSelect: (providerID: string, modelID: string) => void
  sheetRef: React.RefObject<BottomSheet | null>
  /** Opens Settings → Models. */
  onManageModels?: () => void
}

export function ModelPicker({ providers, selected, isDark, onSelect, sheetRef, onManageModels }: Props) {
  const { t } = useTranslation()
  const { search, setSearch, sections, favorites, toggle } = useModelPickerData(providers, selected)

  const handleSelect = useCallback(
    (providerID: string, modelID: string) => {
      onSelect(providerID, modelID)
      setSearch("")
      sheetRef.current?.close()
    },
    [onSelect, setSearch, sheetRef],
  )

  const handleManage = useCallback(() => {
    setSearch("")
    sheetRef.current?.close()
    onManageModels?.()
  }, [onManageModels, setSearch, sheetRef])

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={["50%", "80%"]}
      // See DirectoryBrowserSheet.tsx for why this is required alongside
      // static snapPoints (issue #104): without it the sheet can never open.
      enableDynamicSizing={false}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={isDark ? s.sheetDark : s.sheet}
      handleIndicatorStyle={{ backgroundColor: isDark ? "#666666" : "#cccccc" }}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
      )}
      onChange={(idx) => {
        if (idx === -1) setSearch("")
      }}
    >
      <View style={s.header}>
        <Text style={[s.title, isDark && p.textWhite]}>{t("chat.modelPicker.title")}</Text>
        <BottomSheetTextInput
          style={[s.search, isDark && s.searchDark]}
          placeholder={t("chat.modelPicker.searchPlaceholder")}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          testID="model-picker-search"
        />
      </View>
      <BottomSheetSectionList
        sections={sections}
        keyExtractor={(item: ModelPickerItem) => `${item.providerID}/${item.modelID}`}
        renderSectionHeader={({ section }: { section: { title: string } }) => (
          <View style={[s.sectionHeader, isDark && s.sectionHeaderDark]}>
            <Text style={[s.sectionTitle, isDark && p.metaDark]}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }: { item: ModelPickerItem }) => (
          <ModelPickerRow
            item={item}
            selected={selected}
            isDark={isDark}
            favorites={favorites}
            onSelect={handleSelect}
            onToggle={toggle}
            freeLabel={t("chat.modelPicker.freeBadge")}
            favoriteToggleLabel={t("chat.modelPicker.favoriteToggle")}
          />
        )}
        ListFooterComponent={
          onManageModels ? (
            <TouchableOpacity
              style={[s.manageRow, isDark && s.manageRowDark]}
              onPress={handleManage}
              testID="model-picker-manage"
            >
              <Ionicons name="options-outline" size={18} color={isDark ? "#cccccc" : "#444444"} />
              <Text style={[s.manageText, isDark && p.textWhite]}>{t("chat.modelPicker.manageModels")}</Text>
            </TouchableOpacity>
          ) : undefined
        }
        contentContainerStyle={s.content}
        stickySectionHeadersEnabled
      />
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  sheet: { backgroundColor: "#ffffff" },
  sheetDark: { backgroundColor: "#1a1a1a" },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  title: { fontSize: 18, fontWeight: "700", color: "#0a0a0a" },
  search: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0a0a0a",
  },
  searchDark: { backgroundColor: "#2a2a2a", color: "#ffffff" },
  content: { paddingBottom: 40 },
  sectionHeader: {
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionHeaderDark: { backgroundColor: "#111111" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#999999",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5e5",
    marginTop: 4,
  },
  manageRowDark: { borderTopColor: "#2a2a2a" },
  manageText: { fontSize: 15, fontWeight: "500", color: "#0a0a0a" },
})
