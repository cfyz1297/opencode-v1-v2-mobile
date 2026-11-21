# Технологический стек

Проект: форк `cfyz1297/opencode-v1-v2-mobile` (до 0.3.0 назывался `opencode-mobile`) — Expo/React Native клиент к self-hosted `opencode serve`, работающий с **обоими** поколениями API: V1 (opencode 1.18.x) и V2 (opencode 2.x). Публикуется только как APK через GitHub Releases (`README.md`, `HANDOFF.md`).

Актуально на 2026-11-20, версия **0.3.22**, versionCode **87** (релизный коммит `1b5acf4`).

## Обязательные разделы

### 1) Сводка по runtime

| Область | Значение | Evidence |
|---------|----------|----------|
| Основной язык | TypeScript / TSX: 207 `.ts` (включая 115 тестовых) + 46 `.tsx` по скану; Kotlin — 7 файлов нативного слоя в `android/` (копии тех же 5 в `plugins/native/keepalive/`) | `docs/codebase/.codebase-scan.txt` (CODE METRICS), `android/app/src/main/java/cc/agentlabs/opencode/` |
| Runtime приложения | React Native **0.88.1** на Hermes, новая архитектура (`newArchEnabled=true`, `hermesEnabled=true`), **Expo SDK 58**, React 19.3.0, React Compiler включён (`experiments.reactCompiler`) | `package.json`, `android/gradle.properties`, `app.json` |
| Runtime тестов / CI | Node.js 24+ (нативное type-stripping для `.test.ts`); job `test` в CI на Node 24, job `build` — Node 20 | `.github/workflows/build.yml`, `scripts/run-tests.mjs` |
| Пакетный менеджер | npm; lockfile v3; `legacy-peer-deps=true` | `package-lock.json`, `.npmrc`, `.github/workflows/build.yml` |
| Модульная система / сборка | Metro + `expo-router/entry` (JS), затем `expo prebuild` → Gradle `assembleRelease` (Android) | `package.json` (`main`), `metro.config.js`, `.github/workflows/build.yml` |
| Версия приложения | **0.3.22, versionCode 87** | `package.json`, `app.json`, `android/app/build.gradle` |
| Тесты | **852 теста, 0 падений**; покрытие **98.27 % строк / 86.85 % ветвей / 96.75 % функций**; `npm run typecheck` — чисто | локальный прогон 2026-11-20 |

### 2) Продакшн-фреймворки и зависимости

Только высокоуровневые (полный список — `package.json`). Версии Expo-модулей в SDK 58 выровнены по мажору (`~58.x`).

| Зависимость | Версия | Роль в системе | Evidence |
|-------------|--------|----------------|----------|
| `expo` | `^58.0.0` | Платформа, нативные модули, prebuild | `package.json` |
| `react-native` | `0.88.1` | UI-runtime, Hermes | `package.json` |
| `react` | `19.3.0` | UI | `package.json` |
| `expo-router` | `~58.0.31` | Файловый роутинг: `app/` = маршруты | `package.json`, `app/_layout.tsx` |
| `zustand` | `^5.0.2` | Все глобальные сторы (`src/stores/*`) | `src/stores/sessions.ts` |
| `i18next` + `react-i18next` | `^26.3.6` / `^17.0.10` | Локализация en / ru / zh-Hans | `src/lib/i18n/config.ts`, `src/lib/i18n/catalog-parity.test.ts` |
| `expo-secure-store` | `~58.0.3` | Пароли серверов, настройки, офлайн-история, недавние каталоги | `src/stores/connections.ts`, `src/lib/history-storage.ts` |
| `@react-native-async-storage/async-storage` | `2.2.0` | Видимость и любимые модели, проверка обновлений | `src/lib/model-visibility.ts`, `src/stores/model-favorites.ts`, `src/lib/update-check.ts` |
| `expo-notifications` | `~58.1.9` | Канал/разрешения уведомлений; на Android публикация идёт через собственный мост `Notify`, на iOS — через этот модуль | `src/lib/notifications.ts`, `plugins/native/keepalive/NotifyModule.kt` |
| `expo-local-authentication` | `~58.0.3` | Биометрический AppGate | `src/stores/auth.ts` |
| `expo-image-picker`, `expo-image-manipulator` | `~58.0.10`, `~58.0.16` | Вложения-изображения (JPEG + base64) | `app/session/[id].tsx` (`pickFromLibrary`) |
| `expo-speech-recognition` | `~58.0.1` | Голосовой ввод | `src/lib/speech.ts`, `app.json` |
| `react-native-marked` | `8.0.0` | Рендер Markdown ответов модели. Картинки рисует свой `MarkdownImage` (у библиотечного `MDImage` эффект без зависимостей — бесконечный ре-рендер), ключи React — счётчик, а не `github-slugger` | `src/components/markdown/Markdown.tsx`, `src/components/markdown/MarkdownImage.tsx` |
| `@gorhom/bottom-sheet` | `^5.2.14` | Шиты: модель, каталог, уровень рассуждений, действия | `app/_layout.tsx`, `src/components/chat/VariantPicker.tsx` |
| `react-native-svg` | `15.16.0` | Кольцо контекста в заголовке сессии | `src/components/chat/ContextRing.tsx` |
| `react-native-reanimated` / `worklets`, `gesture-handler`, `screens`, `safe-area-context` | `4.7.1` / `0.13.0`, `~3.3.0`, `~4.30.1`, `~5.11.1` | Анимации, жесты, навигация, инсеты | `package.json` |
| `@expo/vector-icons` | `^15.0.3` | Иконки | `package.json` |
| `expo-clipboard`, `expo-constants`, `expo-crypto`, `expo-device`, `expo-font`, `expo-linking`, `expo-localization`, `expo-splash-screen`, `expo-status-bar`, `expo-system-ui` | `~58.x` | Буфер, константы, UUID, инфо об устройстве, шрифты, deep links, локаль, сплэш, статус-бар, системный UI | `package.json` |

Отсутствуют намеренно (удалены в форке): `@sentry/react-native`, PostHog, `expo-store-review` — см. `README.md` и `metro.config.js`.

### 3) Инструменты разработки

| Инструмент | Назначение | Evidence |
|------------|------------|----------|
| `typescript ~6.0.3` (`tsc --noEmit`, `strict: true`, `allowImportingTsExtensions`) | Проверка типов; `include` покрывает и тесты | `package.json`, `tsconfig.json` |
| `node:test` (встроенный) через `scripts/run-tests.mjs` | Тест-раннер; явный glob, отказ при нуле файлов | `scripts/run-tests.mjs` |
| `--experimental-test-coverage` с порогами 80 % | Покрытие строк/ветвей/функций | `package.json` (`test:coverage`) |
| `scripts/check-version-parity.mjs` | Сверка `package.json` ↔ `app.json` ↔ `android/app/build.gradle` | `scripts/check-version-parity.mjs` |
| `scripts/cua-roadmap-smoke.mjs` | Android CUA smoke на эмуляторе (UIAutomator + фиктивный сервер) | `scripts/cua-roadmap-smoke.mjs` |
| `plugins/with-native-customizations.js` | Единственный источник правды для нативных правок (подпись, IME, cleartext, keep-alive); `android/` перегенерируется prebuild'ом | `plugins/with-native-customizations.js:1-2` |
| `gitleaks/gitleaks-action@v2` | Скан секретов в истории | `.github/workflows/security-scan.yml` |

Линтера и форматтера в репозитории нет: `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `.editorconfig`, `.husky` отсутствуют, соответствующих зависимостей нет.

Контейнеров и оркестрации нет: сборка идёт на раннере GitHub Actions с Android SDK.

### 4) Ключевые команды

```bash
npm ci --legacy-peer-deps           # установка (как в CI)
npm start                           # Expo dev server
npm run android                     # dev-сборка (expo run:android)
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease   # релизный APK
npm test                            # 852 теста через scripts/run-tests.mjs
npm run test:coverage               # те же тесты + пороги 80 %
npm run typecheck                   # tsc --noEmit
npm run check:versions              # паритет версий в трёх файлах
```

Версия живёт в трёх местах: `package.json`, `app.json` (`version` + `android.versionCode`) и `android/app/build.gradle`. Литералов версии в workflow больше нет — шаг проверки APK читает ожидаемые значения из `app.json` (`EXPECTED_VERSION_CODE=$(node -p "require('./app.json').expo.android.versionCode")`). Четвёртое место — `version` в корне `package-lock.json` и в `packages[""]`: с 0.3.22 `check:versions` сверяет и их (`scripts/check-version-parity.mjs`), так что отставший lockfile теперь валит сборку. iOS-блок из `app.json` и скрипт `npm run ios` удалены — iOS в форке не поддерживается. Релиз: тег `vX.Y.Z` → GitHub Release с `opencode-mobile-v2.apk` и `SHA256SUMS.txt`; сам релиз публикуется вручную, а ассеты прикладывает шаг `Attach the verified APK to the release` в `build.yml` (dispatch с `reuse_apk_run_id` тегового прогона и `release_tag`), потому что заливка с телефона рвётся.

### 5) Окружение и конфигурация

- Источники конфигурации: `app.json` (Expo-манифест, permissions, plugins), `tsconfig.json`, `metro.config.js`, `android/gradle.properties`, `plugins/with-tablet-config-changes.js`, `plugins/with-native-customizations.js`, `.npmrc`.
- `android/` — **результат `expo prebuild`**, а не источник истины: с SDK 58 он перегенерируется на каждом прогоне, ручные правки теряются; нативные изменения вносятся плагином (`plugins/with-native-customizations.js:1-2`).
- Переменные окружения, реально читаемые кодом:
  - `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` — `plugins/with-native-customizations.js` (блок `signingConfigs`); в CI из секретов `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` (`.github/workflows/build.yml`).
- `.env.example` / `.env.template` отсутствуют; `.env*` в `.gitignore`.
- Ограничения деплоя: только Android APK; магазины удалены; подпись — постоянный keystore, иначе обновление «поверх» невозможно; при отсутствии секрета собирается debug-ключ.

### 6) Evidence

- `package.json`, `package-lock.json`, `app.json`, `tsconfig.json`, `metro.config.js`, `.npmrc`
- `.github/workflows/build.yml`, `.github/workflows/security-scan.yml`
- `android/app/build.gradle`, `android/gradle.properties`
- `plugins/with-native-customizations.js`, `plugins/with-tablet-config-changes.js`
- `scripts/run-tests.mjs`, `scripts/check-version-parity.mjs`, `scripts/cua-roadmap-smoke.mjs`
- `src/stores/model-favorites.ts`, `src/components/chat/ContextRing.tsx`
- `docs/codebase/.codebase-scan.txt`
