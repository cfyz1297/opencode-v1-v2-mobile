# Технологический стек

Проект: форк `cfyz1297/opencode-v1-v2-mobile` (до 0.3.0 назывался `opencode-mobile`) — Expo/React Native клиент к self-hosted `opencode serve`, работающий с **обоими** поколениями API: V1 (opencode 1.18.x) и V2 (opencode 2.x). Публикуется только как APK через GitHub Releases (`README.md`, `HANDOFF.md`).

Актуально на 2026-11-07, коммит `b0d31bc` (после релиза 0.3.3; текущий `main`).

## Обязательные разделы

### 1) Сводка по runtime

| Область | Значение | Evidence |
|---------|----------|----------|
| Основной язык | TypeScript / TSX: 165 `.ts` + 41 `.tsx` (скан), плюс Kotlin (2 файла) для нативного Android-слоя | `docs/codebase/.codebase-scan.txt` (CODE METRICS), `android/app/src/main/java/cc/agentlabs/opencode/MainActivity.kt` |
| Runtime приложения | React Native 0.81.5 на Hermes, новая архитектура (`newArchEnabled=true`, `hermesEnabled=true`), Expo SDK 54 | `package.json`, `android/gradle.properties` |
| Runtime тестов / CI | Node.js 24+ (нативное type-stripping для `.test.ts`); на машине разработки — Node 26 | `.github/workflows/build.yml`, `scripts/run-tests.mjs` |
| Пакетный менеджер | npm; lockfile v3; `legacy-peer-deps=true` | `package-lock.json`, `.npmrc`, `.github/workflows/build.yml` |
| Модульная система / сборка | Metro + `expo-router/entry` (JS), затем `expo prebuild` → Gradle `assembleRelease` (Android) | `package.json` (`main`), `metro.config.js`, `.github/workflows/build.yml` |
| Версия приложения | **0.3.3, versionCode 68** | `package.json`, `app.json`, `android/app/build.gradle` |
| Тесты | **651 тест, 0 падений**; покрытие 98.36 % строк / 86.22 % ветвей / 97.24 % функций | локальный прогон 2026-11-07 |

### 2) Продакшн-фреймворки и зависимости

Только высокоуровневые (полный список — `package.json`).

| Зависимость | Версия | Роль в системе | Evidence |
|-------------|--------|----------------|----------|
| `expo` | `^54.0.0` | Платформа, нативные модули, prebuild | `package.json` |
| `react-native` | `0.81.5` | UI-runtime, Hermes | `package.json` |
| `react` | `19.1.0` | UI | `package.json` |
| `expo-router` | `~6.0.22` | Файловый роутинг: `app/` = маршруты | `package.json`, `app/_layout.tsx` |
| `zustand` | `^5.0.2` | Все глобальные сторы (`src/stores/*`) | `src/stores/sessions.ts` |
| `i18next` + `react-i18next` | `^26.3.6` / `^17.0.10` | Локализация en / ru / zh-Hans | `src/lib/i18n/config.ts`, `src/lib/i18n/catalog-parity.test.ts` |
| `expo-secure-store` | `~15.0.8` | Пароли серверов, настройки, офлайн-история | `src/stores/connections.ts`, `src/lib/history-storage.ts` |
| `@react-native-async-storage/async-storage` | `2.2.0` | Видимость и любимые модели, проверка обновлений | `src/lib/model-visibility.ts`, `src/stores/model-favorites.ts`, `src/lib/update-check.ts` |
| `expo-notifications` | `~0.32.16` | Локальные уведомления (не push) | `src/lib/notifications.ts` |
| `expo-local-authentication` | `~17.0.8` | Биометрический AppGate | `src/stores/auth.ts` |
| `expo-image-picker`, `expo-image-manipulator` | `17.0.10`, `~14.0.8` | Вложения-изображения (JPEG + base64) | `app/session/[id].tsx` (`pickFromLibrary`) |
| `expo-speech-recognition` | `3.0.1` | Голосовой ввод | `src/lib/speech.ts`, `app.json` |
| `react-native-marked` | `8.0.0` | Рендер Markdown ответов модели | `src/components/markdown/Markdown.tsx` |
| `@gorhom/bottom-sheet` | `5.2.8` | Шиты: модель, каталог, уровень рассуждений, действия | `app/_layout.tsx`, `src/components/chat/VariantPicker.tsx` |
| `react-native-svg` | `15.15.1` | Кольцо контекста в заголовке сессии | `src/components/chat/ContextRing.tsx` |
| `react-native-reanimated`, `gesture-handler`, `screens`, `safe-area-context`, `worklets` | см. `package.json` | Анимации, жесты, навигация, инсеты | `package.json` |
| `@expo/vector-icons` | `^15.0.3` | Иконки | `package.json` |
| `expo-clipboard`, `expo-crypto`, `expo-device`, `expo-linking`, `expo-localization`, `expo-status-bar` | см. `package.json` | Буфер, UUID, инфо об устройстве, deep links, локаль, статус-бар | `package.json` |

Отсутствуют намеренно (удалены в форке): `@sentry/react-native`, PostHog, `expo-store-review` — см. `README.md` и `metro.config.js`.

### 3) Инструменты разработки

| Инструмент | Назначение | Evidence |
|------------|------------|----------|
| `typescript ~5.9.2` (`tsc --noEmit`, `strict: true`) | Проверка типов | `package.json`, `tsconfig.json` |
| `node:test` (встроенный) через `scripts/run-tests.mjs` | Тест-раннер; явный glob, отказ при нуле файлов | `scripts/run-tests.mjs` |
| `--experimental-test-coverage` с порогами 80 % | Покрытие строк/ветвей/функций | `package.json` |
| `scripts/check-version-parity.mjs` | Сверка версии в `package.json` ↔ `app.json` ↔ `android/app/build.gradle` | `scripts/check-version-parity.mjs` |
| `scripts/cua-roadmap-smoke.mjs` | Android CUA smoke на эмуляторе (UIAutomator + фиктивный сервер) | `scripts/cua-roadmap-smoke.mjs` |
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
npm test                            # 651 тест через scripts/run-tests.mjs
npm run test:coverage               # те же тесты + пороги 80 %
npm run typecheck                   # tsc --noEmit
npm run check:versions              # паритет версий в трёх файлах
```

Перед релизом версия поднимается в четырёх местах: `package.json`, `app.json` (version и versionCode), `android/app/build.gradle` и литералы в `.github/workflows/build.yml` (шаг проверки собранного APK). Затем `check:versions` → тег `vX.Y.Z` → GitHub Release с `opencode-mobile-v2.apk` и `SHA256SUMS.txt`.

### 5) Окружение и конфигурация

- Источники конфигурации: `app.json` (Expo-манифест, permissions, plugins), `tsconfig.json`, `metro.config.js`, `android/gradle.properties`, `android/app/build.gradle`, `plugins/with-tablet-config-changes.js`, `.npmrc`.
- Переменные окружения, реально читаемые кодом:
  - `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` — `android/app/build.gradle`; в CI из секретов `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
- `.env.example` / `.env.template` отсутствуют; `.env*` в `.gitignore`.
- Ограничения деплоя: только Android APK; магазины и iOS-сборка удалены; подпись — постоянный keystore, иначе обновление «поверх» невозможно; при отсутствии секрета собирается debug-ключ.

### 6) Evidence

- `package.json`, `package-lock.json`, `app.json`, `tsconfig.json`, `metro.config.js`, `.npmrc`
- `.github/workflows/build.yml`, `.github/workflows/security-scan.yml`
- `android/app/build.gradle`, `android/gradle.properties`
- `scripts/run-tests.mjs`, `scripts/check-version-parity.mjs`, `scripts/cua-roadmap-smoke.mjs`
- `src/stores/model-favorites.ts`, `src/components/chat/ContextRing.tsx`
- `docs/codebase/.codebase-scan.txt`
