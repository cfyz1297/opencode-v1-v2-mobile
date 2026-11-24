import { useCallback, useMemo, useState } from "react"
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Alert,
} from "react-native"
import { Stack, router } from "expo-router"
import * as Clipboard from "expo-clipboard"
import { useTranslation } from "react-i18next"
import { buildCustomProviderPlan, validateCustomProvider } from "../../src/lib/custom-provider"
import { connectHref } from "../../src/lib/providers-ui"

export default function CustomProviderScreen() {
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const { t } = useTranslation()

  const [id, setId] = useState("")
  const [name, setName] = useState("")
  const [baseURL, setBaseURL] = useState("")
  const [modelID, setModelID] = useState("")
  const [modelName, setModelName] = useState("")
  const [configPreview, setConfigPreview] = useState<string | null>(null)
  const [steps, setSteps] = useState<string[]>([])

  const input = useMemo(
    () => ({ id, name, baseURL, modelID, modelName }),
    [id, name, baseURL, modelID, modelName],
  )

  const validation = useMemo(() => validateCustomProvider(input), [input])

  const fieldError = useCallback(
    (key: keyof typeof input) => {
      const code = validation.errors[key]
      if (!code) return null
      return t(`providers.custom.errors.${code}`)
    },
    [t, validation.errors],
  )

  const onGenerate = useCallback(async () => {
    const plan = buildCustomProviderPlan(input)
    if (!plan) {
      Alert.alert(t("common.error"), t("providers.custom.invalidForm"))
      return
    }
    // Defence: never accept a plan that embeds literal secrets.
    setConfigPreview(plan.configJson)
    setSteps(plan.termuxSteps)
  }, [input, t])

  const onCopyConfig = useCallback(async () => {
    if (!configPreview) return
    await Clipboard.setStringAsync(configPreview)
    Alert.alert(t("common.ok"), t("providers.custom.copiedConfig"))
  }, [configPreview, t])

  const onCopySteps = useCallback(async () => {
    if (steps.length === 0) return
    await Clipboard.setStringAsync(steps.join("\n"))
    Alert.alert(t("common.ok"), t("providers.custom.copiedSteps"))
  }, [steps, t])

  const onConnectKey = useCallback(() => {
    const plan = buildCustomProviderPlan(input)
    if (!plan) {
      Alert.alert(t("common.error"), t("providers.custom.invalidForm"))
      return
    }
    router.push(connectHref(plan.providerID))
  }, [input, t])

  return (
    <>
      <Stack.Screen options={{ title: t("providers.custom.title") }} />
      <ScrollView
        style={[styles.container, isDark && styles.containerDark]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="custom-provider-screen"
      >
        <Text style={[styles.lead, isDark && styles.metaDark]}>{t("providers.custom.lead")}</Text>
        <Text style={[styles.securityNote, isDark && styles.metaDark]}>{t("providers.custom.noSecretsNote")}</Text>

        <Field
          label={t("providers.custom.fields.id")}
          value={id}
          onChangeText={setId}
          placeholder="acme"
          isDark={isDark}
          error={fieldError("id")}
          testID="custom-provider-id"
          autoCapitalize="none"
        />
        <Field
          label={t("providers.custom.fields.name")}
          value={name}
          onChangeText={setName}
          placeholder="Acme LLM"
          isDark={isDark}
          error={fieldError("name")}
          testID="custom-provider-name"
        />
        <Field
          label={t("providers.custom.fields.baseURL")}
          value={baseURL}
          onChangeText={setBaseURL}
          placeholder="https://api.example.com/v1"
          isDark={isDark}
          error={fieldError("baseURL")}
          testID="custom-provider-baseurl"
          autoCapitalize="none"
          keyboardType="url"
        />
        <Field
          label={t("providers.custom.fields.modelID")}
          value={modelID}
          onChangeText={setModelID}
          placeholder="qwen3-coder"
          isDark={isDark}
          error={fieldError("modelID")}
          testID="custom-provider-model-id"
          autoCapitalize="none"
        />
        <Field
          label={t("providers.custom.fields.modelName")}
          value={modelName}
          onChangeText={setModelName}
          placeholder="Qwen 3 Coder"
          isDark={isDark}
          error={null}
          testID="custom-provider-model-name"
        />

        <TouchableOpacity
          style={[styles.primaryBtn, !validation.ok && styles.primaryBtnDisabled]}
          onPress={onGenerate}
          disabled={!validation.ok}
          testID="custom-provider-generate"
        >
          <Text style={styles.primaryBtnText}>{t("providers.custom.generate")}</Text>
        </TouchableOpacity>

        {configPreview && (
          <View style={[styles.previewCard, isDark && styles.previewCardDark]} testID="custom-provider-preview">
            <Text style={[styles.previewTitle, isDark && styles.textDark]}>{t("providers.custom.configTitle")}</Text>
            <Text style={[styles.code, isDark && styles.codeDark]} selectable>
              {configPreview}
            </Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onCopyConfig} testID="custom-provider-copy-config">
              <Text style={[styles.secondaryBtnText, isDark && styles.textDark]}>{t("providers.custom.copyConfig")}</Text>
            </TouchableOpacity>

            <Text style={[styles.previewTitle, isDark && styles.textDark, { marginTop: 16 }]}>
              {t("providers.custom.stepsTitle")}
            </Text>
            {steps.map((step, i) => (
              <Text key={i} style={[styles.step, isDark && styles.metaDark]}>
                {i + 1}. {step}
              </Text>
            ))}
            <TouchableOpacity style={styles.secondaryBtn} onPress={onCopySteps} testID="custom-provider-copy-steps">
              <Text style={[styles.secondaryBtnText, isDark && styles.textDark]}>{t("providers.custom.copySteps")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 12 }]}
              onPress={onConnectKey}
              testID="custom-provider-connect-key"
            >
              <Text style={styles.primaryBtnText}>{t("providers.custom.connectKeyCta")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </>
  )
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  isDark,
  error,
  testID,
  autoCapitalize,
  keyboardType,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder: string
  isDark: boolean
  error: string | null
  testID: string
  autoCapitalize?: "none" | "sentences"
  keyboardType?: "default" | "url"
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, isDark && styles.metaDark]}>{label}</Text>
      <TextInput
        style={[styles.input, isDark && styles.inputDark, error ? styles.inputError : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={isDark ? "#666666" : "#999999"}
        autoCorrect={false}
        autoCapitalize={autoCapitalize ?? "sentences"}
        keyboardType={keyboardType ?? "default"}
        testID={testID}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  lead: { fontSize: 14, color: "#444444", lineHeight: 20 },
  securityNote: { fontSize: 13, color: "#666666", lineHeight: 18, marginBottom: 8 },
  metaDark: { color: "#888888" },
  textDark: { color: "#ffffff" },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: "#555555" },
  input: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0a0a0a",
    borderWidth: 1,
    borderColor: "transparent",
  },
  inputDark: { backgroundColor: "#2a2a2a", color: "#ffffff" },
  inputError: { borderColor: "#ef4444" },
  errorText: { fontSize: 12, color: "#ef4444" },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: "#0a0a0a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  previewCard: {
    marginTop: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  previewCardDark: { backgroundColor: "#1a1a1a" },
  previewTitle: { fontSize: 14, fontWeight: "700", color: "#0a0a0a" },
  code: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#222222",
    lineHeight: 18,
  },
  codeDark: { color: "#dddddd" },
  step: { fontSize: 13, color: "#555555", lineHeight: 18 },
  secondaryBtn: {
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cccccc",
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "600", color: "#0a0a0a" },
})
