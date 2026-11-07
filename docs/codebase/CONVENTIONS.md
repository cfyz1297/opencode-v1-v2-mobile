# Соглашения о коде

Правила ниже выведены из фактического кода; инструментов принуждения (линтер/форматтер) в репозитории нет, поэтому единственные автоматические гейты — `tsc --noEmit` и `npm test`.

Актуально на 2026-11-07, коммит `b0d31bc` (0.3.3).

## Обязательные разделы

### 1) Именование

| Объект | Правило | Пример | Evidence |
|--------|---------|--------|----------|
| Файлы `src/lib` | kebab-case, доменное имя | `run-watchdog.ts`, `api-detect.ts`, `sdk-v1.ts`, `session-stats.ts`, `tool-view.ts` | `src/lib/` |
| Файлы компонентов | PascalCase | `src/components/chat/MessageBubble.tsx`, `src/components/chat/ToolCallCard.tsx`, `src/components/chat/DirectorySwitcher.tsx` | `src/components/chat/` |
| Файлы тестов | `<модуль>.test.ts` рядом с модулем; регрессия — `.regression.test.ts`, HTTP — `.integration.test.ts` | `src/lib/run-watchdog.test.ts`, `src/lib/variant-picker-keyboard.regression.test.ts`, `src/lib/sdk-v1.integration.test.ts` | `src/lib/` |
| Хуки | файл kebab-case, экспорт `useXxx` | `src/lib/use-keyboard-height.ts` → `useKeyboardHeight` | `src/lib/use-keyboard-height.ts:16 (useKeyboardHeight)` |
| Функции/методы | camelCase, глагол в начале | `chooseModelSelection`, `reconcileTemps`, `probeConnection` | `src/lib/model-selection.ts:37 (chooseModelSelection)`, `src/lib/message-merge.ts:67 (reconcileTemps)`, `src/lib/connection-health.ts:11 (probeConnection)` |
| Типы/интерфейсы | PascalCase; `interface` для объектных форм, `type` для объединений/алиасов | `interface PartBatcher<T>` / `type ConnectionHealth = "checking" \| "online" \| "offline"` | `src/lib/part-batch.ts:10 (PartBatcher)`, `src/lib/connection-health.ts:3 (ConnectionHealth)` |
| Константы уровня модуля | UPPER_SNAKE | `REQUEST_TIMEOUT_MS`, `MAX_TRACKED`, `PROBE_INTERVAL_MS` | `src/lib/sdk.ts:207 (REQUEST_TIMEOUT_MS)`, `src/lib/v2-compat.ts:607 (MAX_TRACKED)`, `app/(tabs)/connections.tsx:14 (PAGE_SIZE_OPTIONS)` |
| Ключи хранилищ | `snake_case`-строки с префиксом `opencode_` | `opencode_connections`, `opencode_settings`, `opencode_history_<id>`, `opencode_model_favorites_v1` | `src/stores/connections.ts` (`CONNECTIONS_KEY`), `src/stores/settings.ts`, `src/lib/model-visibility.ts:6` |
| Сторы | `use<Домен>` | `useSessions`, `useEvents`, `useModelVisibility`, `useModelFavorites` | `src/stores/*.ts` |
| Тестовые описания | Английский, полное предложение-утверждение | `"a hidden keyboard means no padding, even if a stale height lingers"` | `src/lib/keyboard-inset.test.ts:16` |

Правило про «приватность»: префиксов `_`/`#` нет, приватность выражается `private` в классах (`src/lib/v2-compat.ts:610-614 (V2EventAdapter)`) и не-экспортируемыми функциями модуля (`function request<T>` в `src/lib/sdk.ts:228 (request)`).

### 2) Форматирование и линтинг

- Форматтер: **отсутствует** (нет `.prettierrc*`, `.editorconfig`).
- Линтер: **отсутствует** (нет `.eslintrc*`, `eslint.config.*`, зависимостей eslint).
- Фактический стиль: отступ 2 пробела; в `src/**` преобладают двойные кавычки, точки с запятой в конце строк не ставятся (`grep ';$' src/lib/*.ts` — 8 строк на весь `src/lib`); в тестах и `scripts/*.mjs` встречаются одиночные кавычки и точки с запятой (`src/lib/connections-screen.test.ts:1-5`, `scripts/check-version-parity.mjs`). Стиль не принуждается, поэтому файл-в-файл разнобой допустим.
- `any` формально не запрещён механически, но встречается точечно (`as any`/`: any` в `src`+`app`), обычно на границе известных-неполных типов: `name={icon as any}` (`src/components/chat/ToolCallCard.tsx:347 (ToolCallCard)`), `(event as any).payload` (`src/stores/events.ts:398 (connect)`). `AGENTS.md` требует «без `any`» — фактически это правило нарушается в 24 местах.
- TypeScript: `strict: true`, наследование `expo/tsconfig.base` (`tsconfig.json:2-4`). `include` охватывает и `*.test.ts(x)`: `npm run typecheck` проверяет тесты наравне с исходниками.
- Запуск: `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run check:versions`.
- Числа на 2026-11-07: **651 тест**, покрытие **98.36 % строк / 86.22 % ветвей / 97.24 % функций**.

### 3) Импорты и модули

- Порядок: внешние пакеты → внутренние модули; алфавитной сортировки нет, группировка не принуждается.
- Алиас `@/*` объявлен (`tsconfig.json:5-7`), но **не используется** (0 импортов `@/`): конвенция — относительные пути от файла (`../../src/stores/sessions` в `app/`, `./v2-compat` в `src/lib`).
- Общего барреля `src/index.ts` нет. Баррели есть только у двух каталогов компонентов: `src/components/chat/index.ts` (реэкспорт 17 компонентов) и `src/components/markdown/index.tsx`.
- Тестовые файлы импортируют проверяемый модуль **с расширением `.ts`** (`import { keyboardPadding } from "./keyboard-inset.ts"`), production-код — без расширения. Это требование Node type-stripping'а, а не вкусовщина.
- Чистый модуль (`src/lib/*.ts`) не должен импортировать `react-native`/`expo-*`, если для него планируются тесты под `node --test`; нативные обёртки выносятся отдельно (`src/lib/history-storage.ts` ↔ `src/lib/offline-history.ts`, `src/lib/speech-locale.ts` ↔ `src/lib/speech.ts`, `src/lib/i18n/config.ts` ↔ `src/lib/i18n/locale-resolve.ts`).
- Type-only импорты помечаются `import type` (`src/stores/sessions.ts:2`).

### 4) Ошибки и логирование

- Транспорт: не-2xx → `ApiError(status, body)`; 401/403 → auth-ошибка (`src/lib/api-error.ts`). Класс `ApiError` живёт в `api-error.ts`, а не в `sdk.ts`, чтобы оба транспорта (`sdk.ts`, `sdk-v1.ts`) делили его без цикла. 204/пустое тело → `undefined`; не-JSON → `ApiError(0, "Non-JSON response: …")`.
- Сторы: ошибки кладутся в строковое поле состояния (`error: string | null`) и/или логируются, наружу не пробрасываются, кроме `sendMessage`, где ошибка пробрасывается после очистки оптимистичного сообщения (`src/stores/sessions.ts:394-414 (sendMessage)`).
- Fail-closed: недоступность, не-2xx и не-JSON трактуются как «сервер недоступен», успех требует явного признака (`src/lib/connection-health.ts:10-20 (CONNECTION_PROBE_TIMEOUT_MS)`; `AGENTS.md`, раздел «Правила работы»).
- Логи: `console.log/warn/error` с тегом в квадратных скобках: `[SSE]`, `[Events]`, `[sendMessage]` (`src/stores/events.ts:160,339,368`, `src/lib/sdk.ts:380-399 (events)`). Плюс кольцевой буфер `src/lib/logbuffer.ts` (200 записей), который попадает в диагностический отчёт.
- Секреты: пароли/`Authorization`/токены не логируются; отчёт для поддержки проходит через `redactHostAndUrls` (`src/lib/scrub.ts`, `src/lib/diagnostics.ts:186-190 (appVersion)`). Инварианты закреплены статическими тестами `src/lib/security-baseline.test.ts`.
- Записи в SecureStore: пароли и офлайн-история — только с `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`src/stores/connections.ts:19 (SECURE_OPTIONS)`, `src/lib/history-storage.ts:4-6 (offlineHistory)`); перечень разрешённых ключей — `src/lib/persisted-keys.test.ts`.

### 5) Соглашения тестирования

- Каталог: тест лежит рядом с модулем (`src/lib/*.test.ts`), один тест — один файл модуля; исключение по имени: `src/lib/session-recency.test.ts` тестирует `session-grouping.ts`.
- Раннер: встроенный `node:test`, ассерты `node:assert/strict`; `describe/it` редки — почти всё плоские `test(...)`.
- Моки: внедрение зависимостей (фейковое хранилище, фейковый `fetch`), подмена `expo/fetch` через `registerHooks` (`src/lib/sdk.integration.test.ts:1-17`), HTTP-заглушка для интеграционных (`tests/fixtures/mock-opencode-server.ts`), «экранный» харнесс на `vm` + `typescript` (`src/lib/connections-screen.test.ts:1-30`), статические проверки исходников регулярками для того, что нельзя отрендерить (`src/components/wide-content-scroll.regression.test.ts`, `src/lib/dialog-back-gesture.regression.test.ts`).
- Покрытие: гейт 80 % по строкам/ветвям/функциям (`package.json`); фактически 98.36 / 86.22 / 97.24 (прогон 2026-11-07).
- Подробности — `docs/codebase/TESTING.md`.

### 6) Прочие наблюдаемые конвенции

- Комментарии объясняют «почему», часто со ссылкой на issue/BUG-номер (`BUG-016`, `issue #150`, `AGE-87`): `src/stores/connections.ts:73-81 (generateId)`, `src/stores/sessions.ts:164-174 (selectSession)`.
- Коммиты — Conventional Commits по факту истории: `feat(chat): …`, `fix(sessions): …`, `chore: release 0.3.0 — both APIs, new name, keyboard-safe variant picker`, `docs: …` (`git log`). Ветка — `main`.
- Локализация: только фиксированные ключи переводов, три каталога с паритетом ключей (`src/lib/i18n/catalog-parity.test.ts`); строки сервера как разметка не рендерятся (`AGENTS.md`). Новые ключи 0.3.0: `settings.serverApi.*`, `chat.modelPicker.favorites`, `chat.sessionInfo.*`, `session.alerts.abortFailed*`, `connectionsList.preferences.pageSizeAll`. Фактическое исключение — заголовки уведомлений захардкожены по-английски (текст тела при этом фиксированный, см. `notify-format.ts`).
- Тексты уведомлений о подтверждении и вопросе — константы `PERMISSION_NOTIFICATION_BODY` / `QUESTION_NOTIFICATION_BODY` (`src/lib/notify-format.ts`), серверные имена инструментов и текст вопроса в тело не попадают (аудит upstream M-03).
- Заголовки запросов к туннелям: `Bypass-Tunnel-Reminder` и `ngrok-skip-browser-warning` добавляются централизованно в `src/lib/headers.ts`, не в местах вызова.

### 7) Evidence

- `tsconfig.json`
- `package.json`
- `src/stores/sessions.ts`
- `src/stores/events.ts`
- `src/stores/connections.ts`
- `src/lib/sdk.ts`
- `src/lib/api-error.ts`
- `src/lib/headers.ts`, `src/lib/api-detect.ts`, `src/lib/sdk-v1.ts`
- `src/lib/logbuffer.ts`
- `src/lib/scrub.ts`
- `src/lib/security-baseline.test.ts`
- `src/lib/persisted-keys.test.ts`
- `src/components/chat/index.ts`
- `src/components/markdown/index.tsx`
- `src/lib/i18n/catalog-parity.test.ts`
- `src/lib/connections-screen.test.ts`
- `src/components/wide-content-scroll.regression.test.ts`
- `src/lib/dialog-back-gesture.regression.test.ts`
- `AGENTS.md`
