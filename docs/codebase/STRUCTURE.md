# Структура кодовой базы

Актуально на 2026-11-15, коммит `1fdfabc` (0.3.20 / 85).

## Обязательные разделы

### 1) Карта верхнего уровня

| Путь | Назначение | Evidence |
|------|------------|----------|
| `app/` | Маршруты Expo Router (файл = экран, 15 файлов): `(tabs)/` — sessions/connections/settings, `session/[id]`, `connection/*` (add, edit, tunnel), `providers/*` (index, connect, custom), `models`, `history`, `demo` | `app/_layout.tsx`, `find app -name '*.tsx'` |
| `src/lib/` | Чистая логика + два транспорта + адаптер V2→V1 + фоновое удержание и статусы сабагентов; рядом с каждым модулем `*.test.ts` (99 тестовых файлов в `src/`) | `src/lib/sdk.ts`, `src/lib/sdk-v1.ts`, `src/lib/v2-compat.ts` |
| `src/stores/` | Zustand-сторы: `sessions`, `connections`, `events` (SSE + фоновый опрос), `catalog`, `settings`, `auth`, `model-visibility`, `model-favorites` | `src/stores/*.ts` |
| `src/components/` | UI: `chat/` (пузыри, инструменты, промпты, `SubagentBar`, `SubagentRow`, `ContextRing`, `SessionInfo`), `markdown/`, `AuthGate`, `ErrorBoundary`, `TabletSessions`, `UpdateBanner` | `src/components/` |
| `src/types/` | Локальные `.d.ts` для неполных типов сторонних пакетов | `src/types/` |
| `src/lib/i18n/` | Каталоги `en.json`, `ru.json`, `zh-Hans.json` + конфиг i18next + тесты паритета и локали | `src/lib/i18n/config.ts`, `src/lib/i18n/catalog-parity.test.ts` |
| `tests/fixtures/` | `mock-opencode-server.ts` — HTTP-заглушка **V1**-протокола (живой путь: V1-транспорт использует тот же `loadSessionList`) | `tests/fixtures/mock-opencode-server.ts` |
| `assets/` | Иконки, splash, adaptive-icon | `app.json` |
| `android/` | **Вывод `expo prebuild`** (перегенерируется целиком): Gradle-проект, подпись, Kotlin-модули keep-alive/Notify, ресурсы иконок | `plugins/with-native-customizations.js:1-2` |
| `plugins/` | Источник истины для нативных правок: `with-native-customizations.js` (подпись, IME-репортер, `usesCleartextTraffic`, keep-alive, иконки), `with-tablet-config-changes.js`, `native/keepalive/*.kt`, `native/res/drawable/*.xml` | `plugins/` |
| `scripts/` | `run-tests.mjs`, `run-tests.test.mjs`, `check-version-parity.mjs`, `cua-roadmap-smoke.mjs` | `scripts/` |
| `docs/` | 12 отчётов `security-review-*.md` (0.2.21, 0.3.2, 0.3.8–0.3.15, 0.3.17, server-api), проверки (connection-status, model-visibility, run-resync), upstream review + `docs/codebase/` (эта карта) | `docs/*.md` |
| `llms.txt` | Машиночитаемая сводка проекта для ИИ-краулеров | `llms.txt` |
| `.github/workflows/` | Два активных workflow: `Build Android APK`, `Security scan` | `.github/workflows/*.yml` |
| `.agents/`, `.hallmark/` | `retro.md` — уроки прошлых задач; `.hallmark/salt` — служебный файл внешнего инструмента (одна hex-строка, назначение [TODO]) | `.agents/retro.md`, `.hallmark/salt` |
| `dist/` | Локальные APK, **в Git не попадают** (`dist/` в `.gitignore`) | `.gitignore` |

Верхнеуровневые документы: `README.md` (англ., основной), `README.ru.md`, `HANDOFF.md` (журнал релизов и решений), `llms.txt`, `AGENTS.md`, `LICENSE` (MIT).

### 2) Точки входа

- Основная runtime-точка: `expo-router/entry` (`package.json` → `main`).
- Корневой layout: `app/_layout.tsx` — `I18nextProvider`, `GestureHandlerRootView`, `BottomSheetModalProvider`, `AuthGate`, `ErrorBoundary`; инициализация auth/**settings → connections** (порядок важен: предпочтение `serverApi` решает транспорт), подписки на `AppState` (биометрический лок, `resumeFromBackground`, перезагрузка каталога), `useEvents.connect()`, `useCatalog.load()`, разрешения на уведомления, автосохранение офлайн-истории, обработчик тапа по уведомлению (`notifications.onTap`).
- Вторичные входы: `MainActivity.kt` (`installImeReporter()`, вносится плагином), `MainApplication.kt` (регистрация `KeepAlivePackage`/`NotifyPackage` плагином), CLI-скрипты в `scripts/`, deep link `opencode://` (в т.ч. `opencode://session/<id>` из уведомления).
- CI: `npx expo prebuild` + `gradlew assembleRelease`.

### 3) Границы модулей

| Граница | Что здесь | Чего здесь быть не должно |
|---------|-----------|---------------------------|
| `app/**` | Композиция экранов: вёрстка, локальный UI-стейт, вызовы сторов | Бизнес-логика, парсинг API — в `src/lib` |
| `src/lib/*.ts` (чистые модули) | Функции/классы без RN и expo: `api-detect.ts`, `headers.ts`, `sse.ts`, `v2-compat.ts`, `message-page.ts`, `session-stats.ts`, `tool-view.ts`, `subagent-status.ts`, `keep-alive.ts` (тонкая обёртка над мостом), `offline-history.ts` и др. | Импорты `react-native`, `expo-*`, `zustand` |
| `src/lib/sdk.ts`, `src/lib/sdk-v1.ts` (транспорт) | HTTP/SSE, заголовки, таймауты, маппинг | UI, хранение, чистая логика (вынесена) |
| `src/components/**` | Презентация, `memo`, стили | Запросы к серверу напрямую |
| `src/stores/**` | Глобальное состояние + side effects | JSX, вёрстка |
| `plugins/**` | Источник истины для нативных правок и Kotlin-исходников | Логика приложения на JS |
| `android/**` | Только вывод prebuild; правки здесь теряются при следующем прогоне | Ручные нативные изменения (их место — `plugins/`) |
| `tests/fixtures/**` | HTTP-заглушка | Production-код |

### 4) Правила именования и организации

- `src/lib`: **kebab-case** + домен (`api-detect.ts`, `session-stats.ts`, `tool-duration.ts`, `subagent-status.ts`), тест рядом: `<name>.test.ts`; регрессии — `<name>.regression.test.ts` (9 файлов: `composer-taps`, `session-info`, `variant-picker-keyboard`, `dialog-back-gesture`, `tool-call-card`, `session-header`, `update-banner`, `markdown-inline-code`, `wide-content-scroll`).
- Компоненты: **PascalCase** `.tsx`; маршруты — по сегментам URL.
- Сторы: `src/stores/<домен>.ts`, экспорт `useXxx` (`useSessions`, `useConnections`, `useEvents`, `useCatalog`, `useSettings`, `useAuth`, `useModelVisibility`, `useModelFavorites`).
- Баррели: `src/components/chat/index.ts` (20 реэкспортов) и `src/components/markdown/index.tsx`; остальное — прямыми путями.
- Алиас `@/*` объявлен в `tsconfig.json`, но импортов через него нет — фактическая конвенция: относительные пути.
- Тестовые файлы импортируют модули с явным `.ts` (Node исполняет их type-stripping'ом; в `tsconfig.json` для этого `allowImportingTsExtensions`).
- Карта `src/lib` по назначению (71 модуль верхнего уровня):
  - транспорт/протокол: `sdk.ts`, `sdk-v1.ts`, `api-detect.ts`, `sse.ts`, `v2-compat.ts`, `headers.ts`, `auth.ts`, `api-error.ts`, `directory-client.ts`, `provider-auth.ts`;
  - сессии и сообщения: `session-list.ts`, `session-grouping.ts`, `session-selection.ts`, `session-load-reconcile.ts`, `session-status-reconcile.ts`, `session-id.ts` (валидация id из deep link), `message-merge.ts`, `message-run.ts`, `message-page.ts`, `part-batch.ts`, `part-order.ts`, `part-runs.ts`, `prompt-from-parts.ts`, `revert-filter.ts`, `pending-questions.ts`, `question-answers.ts`, `answered-questions.ts`;
  - сабагенты: `subagent-status.ts` (статус ребёнка, волны, порядок, счётчики);
  - живучесть: `run-watchdog.ts`, `stream-watchdog.ts`, `connection-health.ts`, `keep-alive.ts` (мост к foreground-сервису + headless-задаче);
  - UI-логика: `adaptive-layout.ts`, `keyboard-inset.ts`, `use-keyboard-height.ts`, `scroll-config.ts`, `scroll-follow.ts`, `model-selection.ts`, `model-picker-filter.ts`, `model-visibility.ts`, `session-stats.ts`, `tool-view.ts`, `tool-duration.ts`, `providers-ui.ts`, `status-labels.ts`, `tablet-session-nav.ts`, `notify-format.ts`, `notifications.ts`;
  - хранилище/безопасность: `offline-history.ts`, `history-storage.ts`, `connection-security.ts`, `scrub.ts`, `logbuffer.ts`, `stored-json.ts`, `settings-merge.ts` (прямая совместимость настроек уведомлений);
  - внешнее/утилиты: `update-check.ts`, `update-check-policy.ts`, `diagnostics.ts`, `diagnostics-classify.ts`, `custom-provider.ts`, `tunnel.ts`, `speech.ts`, `speech-errors.ts`, `speech-locale.ts`, `links.ts`, `file-roots.ts`, `path-utils.ts`, `quick-connect-url.ts`, `http.ts`, `demo-script.ts`, `types.ts`.

### 5) Evidence

- `package.json`, `app/_layout.tsx`
- `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/connections.tsx`, `app/(tabs)/settings.tsx`, `app/session/[id].tsx`
- `src/lib/`, `src/stores/`, `src/components/` (деревья получены `find`)
- `plugins/with-native-customizations.js`, `plugins/native/keepalive/`
- `tests/fixtures/mock-opencode-server.ts`
- `.gitignore`, `llms.txt`
- `docs/codebase/.codebase-scan.txt`
