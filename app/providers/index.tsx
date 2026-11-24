import { useCallback, useMemo, useState } from "react"
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  RefreshControl,
  TextInput,
} from "react-native"
import { Stack, router } from "expo-router"
import { useTranslation } from "react-i18next"
import { useCatalog } from "../../src/stores/catalog"
import { useConnections } from "../../src/stores/connections"
import {
  buildProvidersScreenModel,
  connectHref,
  CUSTOM_PROVIDER_ROUTE,
  type ConnectionBadge,
  type PopularProviderRow,
} from "../../src/lib/providers-ui"

export default function ProvidersScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()
  const providers = useCatalog((s) => s.providers)
  const load = useCatalog((s) => s.load)
  const client = useConnections((s) => s.client)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")

  const screen = useMemo(() => buildProvidersScreenModel(providers, query), [providers, query])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const openConnect = useCallback(
    (row: { id: string; name: string; isCustom?: boolean }) => {
      if (row.isCustom) {
        router.push(CUSTOM_PROVIDER_ROUTE)
        return
      }
      router.push(connectHref(row.id))
    },
    [],
  )

  const badgeLabel = useCallback(
    (badge: ConnectionBadge) =>
      badge === "account" ? t("providers.badge.account") : t("providers.badge.apiKey"),
    [t],
  )

  const popularDesc = useCallback(
    (row: PopularProviderRow) =>
      row.descriptionKey === "providers.popular.generic.description"
        ? t(row.descriptionKey, { name: row.name })
        : t(row.descriptionKey),
    [t],
  )

  return (
    <>
      <Stack.Screen options={{ title: t("providers.title") }} />
      <ScrollView
        style={[styles.container, isDark && styles.containerDark]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? "#fff" : "#0a0a0a"} />
        }
        testID="providers-screen"
      >
        <Text style={[styles.subtitle, isDark && styles.metaDark]}>{t("providers.subtitle")}</Text>

        {!client && (
          <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
            <Text style={[styles.emptyText, isDark && styles.metaDark]}>{t("providers.noServer")}</Text>
          </View>
        )}

        <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>{t("providers.connectedTitle")}</Text>
        {screen.connected.length === 0 ? (
          <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
            <Text style={[styles.emptyText, isDark && styles.metaDark]}>{t("providers.connectedEmpty")}</Text>
          </View>
        ) : (
          <View style={[styles.card, isDark && styles.cardDark]}>
            {screen.connected.map((row, index) => (
              <TouchableOpacity
                key={row.id}
                style={[
                  styles.connectedRow,
                  isDark && styles.connectedRowDark,
                  index === screen.connected.length - 1 && styles.rowLast,
                ]}
                onPress={() => openConnect(row)}
                accessibilityRole="button"
                testID={`provider-connected-${row.id}`}
              >
                <View style={styles.connectedMain}>
                  <Text style={[styles.providerName, isDark && styles.textDark]}>{row.name}</Text>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, isDark && styles.badgeDark]}>
                      <Text style={[styles.badgeText, isDark && styles.badgeTextDark]}>{badgeLabel(row.badge)}</Text>
                    </View>
                    <Text style={[styles.modelCount, isDark && styles.metaDark]}>
                      {t("providers.modelsAvailable", { count: row.modelCount })}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.editCta, isDark && styles.editCtaDark]}>
                  {t("providers.connectedEditCta")}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>{t("providers.customTitle")}</Text>
        <View style={[styles.card, isDark && styles.cardDark]}>
          <View style={[styles.popularRow, isDark && styles.connectedRowDark, styles.rowLast]}>
            <View style={styles.popularText}>
              <Text style={[styles.providerName, isDark && styles.textDark]}>{t("providers.custom.rowName")}</Text>
              <Text style={[styles.popularDesc, isDark && styles.metaDark]}>{t(screen.custom.descriptionKey)}</Text>
            </View>
            <TouchableOpacity
              style={[styles.connectBtn, isDark && styles.connectBtnDark]}
              onPress={() => openConnect(screen.custom)}
              testID="provider-connect-other"
            >
              <Text style={[styles.connectBtnText, isDark && styles.connectBtnTextDark]}>
                {t("providers.customCta")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>
          {t("providers.popularTitle")} ({screen.popular.length})
        </Text>
        <TextInput
          style={[styles.search, isDark && styles.searchDark]}
          placeholder={t("providers.searchPlaceholder")}
          placeholderTextColor={isDark ? "#666666" : "#999999"}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          testID="providers-search"
        />
        {screen.popular.length === 0 ? (
          <View style={[styles.emptyCard, isDark && styles.emptyCardDark]}>
            <Text style={[styles.emptyText, isDark && styles.metaDark]}>{t("providers.popularEmpty")}</Text>
          </View>
        ) : (
          <View style={[styles.card, isDark && styles.cardDark]}>
            {screen.popular.map((row, index) => (
              <View
                key={row.id}
                style={[
                  styles.popularRow,
                  isDark && styles.connectedRowDark,
                  index === screen.popular.length - 1 && styles.rowLast,
                ]}
                testID={`provider-popular-${row.id}`}
              >
                <View style={styles.popularText}>
                  <Text style={[styles.providerName, isDark && styles.textDark]}>{row.name}</Text>
                  <Text style={[styles.popularDesc, isDark && styles.metaDark]}>{popularDesc(row)}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.connectBtn, isDark && styles.connectBtnDark]}
                  onPress={() => openConnect(row)}
                  testID={`provider-connect-${row.id}`}
                >
                  <Text style={[styles.connectBtnText, isDark && styles.connectBtnTextDark]}>
                    {t("providers.connectCta")}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  content: { padding: 16, paddingBottom: 40 },
  subtitle: { fontSize: 14, color: "#666666", marginBottom: 20, lineHeight: 20 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#666666",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 8,
  },
  sectionTitleDark: { color: "#999999" },
  search: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0a0a0a",
    marginBottom: 10,
  },
  searchDark: { backgroundColor: "#2a2a2a", color: "#ffffff" },
  card: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    marginBottom: 20,
    overflow: "hidden",
  },
  cardDark: { backgroundColor: "#1a1a1a" },
  emptyCard: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  emptyCardDark: { backgroundColor: "#1a1a1a" },
  emptyText: { fontSize: 14, color: "#666666", lineHeight: 20 },
  connectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  connectedRowDark: { borderBottomColor: "#2a2a2a" },
  rowLast: { borderBottomWidth: 0 },
  connectedMain: { flex: 1, gap: 6 },
  editCta: { fontSize: 13, fontWeight: "600", color: "#0a0a0a" },
  editCtaDark: { color: "#ffffff" },
  providerName: { fontSize: 16, fontWeight: "600", color: "#0a0a0a" },
  textDark: { color: "#ffffff" },
  metaDark: { color: "#888888" },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  badge: {
    backgroundColor: "#e8e8e8",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeDark: { backgroundColor: "#2a2a2a" },
  badgeText: { fontSize: 11, fontWeight: "600", color: "#555555" },
  badgeTextDark: { color: "#bbbbbb" },
  modelCount: { fontSize: 12, color: "#888888" },
  popularRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    gap: 12,
  },
  popularText: { flex: 1, gap: 4 },
  popularDesc: { fontSize: 13, color: "#666666", lineHeight: 18 },
  connectBtn: {
    backgroundColor: "#0a0a0a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  connectBtnDark: { backgroundColor: "#ffffff" },
  connectBtnText: { fontSize: 13, fontWeight: "600", color: "#ffffff" },
  connectBtnTextDark: { color: "#0a0a0a" },
})
