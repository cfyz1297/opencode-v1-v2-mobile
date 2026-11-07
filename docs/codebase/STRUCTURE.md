# Структура кодовой базы

Актуально на 2026-11-07, коммит `b0d31bc` (0.3.3).

## Обязательные разделы

### 1) Карта верхнего уровня

| Путь | Назначение | Evidence |
|------|------------|----------|
| `app/` | Маршруты Expo Router (файл = экран): `(tabs)/` — sessions/connections/settings, `session/[id]`, `connection/*`, `providers/*`, `models`, `history`, `demo` | `app/_layout.tsx` |
| `src/lib/` | Чистая логика + два транспорта + адаптер V2→V1; рядом с каждым модулем `*.test.ts` (78 файлов) | `src/lib/sdk.ts`, `src/lib/sdk-v1.ts`, `src/lib/v2-compat.ts` |
| `src/stores/` | Zustand-сторы: `sessions`, `connections`, `events` (SSE), `catalog`, `settings`, `auth`, `model-visibility`, **`model-favorites`** | `src/stores/*.ts` |
| `src/components/` | UI: `chat/` (пузыри, инструменты, промпты, **`ContextRing`**, `SessionInfo`), `markdown/`, `AuthGate`, `ErrorBoundary`, `TabletSessions`, `UpdateBanner` | `src/components/` |
| `src/types/` | Локальные `.d.ts` для неполных типов сторонних пакетов | `src/types/` |
| `src/lib/i18n/` | Каталоги `en.json`, `ru.json`, `zh-Hans.json` + конфиг i18next + тест паритета | `src/lib/i18n/config.ts`, `src/lib/i18n/catalog-parity.test.ts` |
| `tests/fixtures/` | `mock-opencode-server.ts` — HTTP-заглушка **V1**-протокола (теперь живой путь: V1-транспорт использует тот же `loadSessionList`) | `tests/fixtures/mock-opencode-server.ts` |
| `assets/` | Иконки, splash, adaptive-icon | `app.json` |
| `android/` | Результат `expo prebuild`: Gradle-проект, подпись, `MainActivity.kt` (IME-инсеты) | `android/app/build.gradle` |
| `plugins/` | Expo config-plugin планшетного режима | `plugins/with-tablet-config-changes.js` |
| `scripts/` | `run-tests.mjs`, `check-version-parity.mjs`, `cua-roadmap-smoke.mjs` | `scripts/` |
| `docs/` | Отчёты (security ×2, upstream review, connection/model/resync validation) + `docs/codebase/` (эта карта) | `docs/*.md` |
| `llms.txt` | Машиночитаемая сводка проекта для ИИ-краулеров | `llms.txt` |
| `.github/workflows/` | Два активных workflow: `Build Android APK`, `Security scan` | `.github/workflows/*.yml` |
| `.agents/` | `retro.md` — уроки прошлых задач | `.agents/retro.md` |
| `dist/` | Локальные APK, **в Git не попадают** (`dist/` в `.gitignore`) | `.gitignore` |

Верхнеуровневые документы: `README.md` (англ., основной), `README.ru.md`, `HANDOFF.md` (мастер-документ состояния/релиза), `llms.txt`, `AGENTS.md`, `LICENSE` (MIT).

### 2) Точки входа

- Основная runtime-точка: `expo-router/entry` (`package.json` → `main`).
- Корневой layout: `app/_layout.tsx` — `I18nextProvider`, `GestureHandlerRootView`, `BottomSheetModalProvider`, `AuthGate`, `ErrorBoundary`; инициализация auth/**settings → connections** (порядок важен: предпочтение `serverApi` решает транспорт), подписка на `AppState`, `useEvents.connect()`, `useCatalog.load()`, разрешения на уведомления, автосохранение офлайн-истории.
- Вторичные входы: `MainActivity.kt` (`installImeReporter()`), CLI-скрипты в `scripts/`, deep link `opencode://`.
- CI: `npx expo prebuild` + `gradlew assembleRelease`.

### 3) Границы модулей

| Граница | Что здесь | Чего здесь быть не должно |
|---------|-----------|---------------------------|
| `app/**` | Композиция экранов: вёрстка, локальный UI-стейт, вызовы сторов | Бизнес-логика, парсинг API — в `src/lib` |
| `src/lib/*.ts` (чистые модули) | Функции/классы без RN и expo: `api-detect.ts`, `headers.ts`, `sse.ts`, `v2-compat.ts`, `message-page.ts`, `session-stats.ts`, `tool-view.ts`, `offline-history.ts` и др. | Импорты `react-native`, `expo-*`, `zustand` |
| `src/lib/sdk.ts`, `src/lib/sdk-v1.ts` (транспорт) | HTTP/SSE, заголовки, таймауты, маппинг | UI, хранение, чистая логика (вынесена) |
| `src/components/**` | Презентация, `memo`, стили | Запросы к серверу напрямую |
| `src/stores/**` | Глобальное состояние + side effects | JSX, вёрстка |
| `android/**` | Prebuild-вывод, нативные правки, подпись | Бизнес-логика приложения |
| `tests/fixtures/**` | HTTP-заглушка | Production-код |

### 4) Правила именования и организации

- `src/lib`: **kebab-case** + домен (`run-watchdog.ts`, `api-detect.ts`, `session-stats.ts`, `tool-view.ts`), тест рядом: `<name>.test.ts`; регрессии — `<name>.regression.test.ts` (`composer-taps.regression.test.ts`, `session-info.regression.test.ts`, `variant-picker-keyboard.regression.test.ts`).
- Компоненты: **PascalCase** `.tsx`; маршруты — по сегментам URL.
- Сторы: `src/stores/<домен>.ts`, экспорт `useXxx` (`useSessions`, `useConnections`, `useEvents`, `useCatalog`, `useSettings`, `useAuth`, `useModelVisibility`, **`useModelFavorites`**).
- Баррели: `src/components/chat/index.ts` и `src/components/markdown/index.tsx`; остальное — прямыми путями.
- Алиас `@/*` объявлен в `tsconfig.json`, но импортов через него нет — фактическая конвенция: относительные пути.
- Тестовые файлы импортируют модули с явным `.ts` (Node исполняет их type-stripping'ом).
- Карта `src/lib` по назначению:
  - транспорт/протокол: `sdk.ts`, **`sdk-v1.ts`**, **`api-detect.ts`**, `sse.ts`, `v2-compat.ts`, `headers.ts`, `auth.ts`, `api-error.ts`, `directory-client.ts`, `provider-auth.ts`;
  - сессии и сообщения: `session-list.ts`, `session-grouping.ts`, `session-selection.ts`, `session-load-reconcile.ts`, `session-status-reconcile.ts`, `message-merge.ts`, `message-run.ts`, **`message-page.ts`**, `part-batch.ts`, `part-order.ts`, `part-runs.ts`, `prompt-from-parts.ts`, `revert-filter.ts`, `pending-questions.ts`, `question-answers.ts`, `answered-questions.ts`;
  - живучесть: `run-watchdog.ts`, `stream-watchdog.ts`, `connection-health.ts`;
  - UI-логика: `adaptive-layout.ts`, `keyboard-inset.ts`, `scroll-config.ts`, `scroll-follow.ts`, `model-selection.ts`, `model-picker-filter.ts`, `model-visibility.ts`, **`session-stats.ts`**, **`tool-view.ts`**, `providers-ui.ts`, `status-labels.ts`, `tablet-session-nav.ts`, `notify-format.ts`;
  - хранилище/безопасность: `offline-history.ts`, `history-storage.ts`, `connection-security.ts`, `scrub.ts`, `logbuffer.ts`;
  - внешнее: `update-check.ts`, `update-check-policy.ts`, `diagnostics.ts`, `diagnostics-classify.ts`, `custom-provider.ts`, `tunnel.ts`, `speech.ts`, `speech-errors.ts`, `links.ts`, `file-roots.ts`, `path-utils.ts`, `quick-connect-url.ts`, `stored-json.ts`, `http.ts`.

### 5) Evidence

- `package.json`, `app/_layout.tsx`
- `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/connections.tsx`, `app/(tabs)/settings.tsx`, `app/session/[id].tsx`
- `src/lib/`, `src/stores/`, `src/components/` (деревья получены `find`)
- `tests/fixtures/mock-opencode-server.ts`
- `.gitignore`, `llms.txt`
- `docs/codebase/.codebase-scan.txt`
