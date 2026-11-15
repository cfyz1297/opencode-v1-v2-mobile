# Соглашения о коде

Правила ниже выведены из фактического кода; инструментов принуждения (линтер/форматтер) в репозитории нет, поэтому единственные автоматические гейты — `tsc --noEmit` и `npm test`.

Актуально на 2026-11-15, коммит `1fdfabc` (0.3.20).

## Обязательные разделы

### 1) Именование

| Объект | Правило | Пример | Evidence |
|--------|---------|--------|----------|
| Файлы `src/lib` | kebab-case, доменное имя | `run-watchdog.ts`, `api-detect.ts`, `sdk-v1.ts`, `subagent-status.ts`, `tool-duration.ts` | `src/lib/` |
| Файлы компонентов | PascalCase | `src/components/chat/MessageBubble.tsx`, `src/components/chat/SubagentBar.tsx`, `src/components/chat/DirectorySwitcher.tsx` | `src/components/chat/` |
| Файлы тестов | `<модуль>.test.ts` рядом с модулем; регрессия — `.regression.test.ts`, HTTP — `.integration.test.ts`, дым — `.smoke.test.ts` | `src/lib/subagent-status.test.ts`, `src/lib/composer-taps.regression.test.ts`, `src/lib/sdk-v1.integration.test.ts`, `src/lib/providers-navigation.smoke.test.ts` | `src/lib/` |
| Хуки | файл kebab-case, экспорт `useXxx` | `src/lib/use-keyboard-height.ts` → `useKeyboardHeight` | `src/lib/use-keyboard-height.ts` |
| Функции/методы | camelCase, глагол в начале | `chooseModelSelection`, `reconcileTemps`, `deriveSubagentStatus`, `formatToolDuration` | `src/lib/model-selection.ts:37`, `src/lib/subagent-status.ts:24`, `src/lib/tool-duration.ts:7` |
| Типы/интерфейсы | PascalCase; `interface` для объектных форм, `type` для объединений/алиасов | `interface SubagentRef` / `type SubagentStatus = "running" \| "done" \| "failed" \| "idle"` | `src/lib/subagent-status.ts:18-58` |
| Константы уровня модуля | UPPER_SNAKE | `REQUEST_TIMEOUT_MS`, `MAX_TRACKED`, `BACKGROUND_POLL_MS` | `src/lib/http.ts:7`, `src/lib/v2-compat.ts:627`, `src/stores/events.ts:404` |
| Ключи хранилищ | `snake_case`-строки с префиксом `opencode_` | `opencode_connections`, `opencode_settings`, `opencode_recent_dirs`, `opencode_history_<id>`, `opencode_model_favorites_v1` | `src/stores/connections.ts:18-23`, `src/stores/settings.ts:11`, `src/lib/model-visibility.ts` |
| Сторы | `use<Домен>` | `useSessions`, `useEvents`, `useModelVisibility`, `useModelFavorites` | `src/stores/*.ts` |
| Тестовые описания | Английский, полное предложение-утверждение | `"a hidden keyboard means no padding, even if a stale height lingers"` | `src/lib/keyboard-inset.test.ts` |

Правило про «приватность»: префиксов `_`/`#` нет, приватность выражается `private` в классах (`src/lib/v2-compat.ts:629 (V2EventAdapter)`) и не-экспортируемыми функциями модуля (`function request<T>` в `src/lib/sdk.ts`).

### 2) Форматирование и линтинг

- Форматтер: **отсутствует** (нет `.prettierrc*`, `.editorconfig`).
- Линтер: **отсутствует** (нет `.eslintrc*`, `eslint.config.*`, зависимостей eslint).
- Фактический стиль: отступ 2 пробела; в `src/**` преобладают двойные кавычки, точки с запятой в конце строк не ставятся (`grep ';$' src/lib/*.ts` без тестов — 7 строк в 6 файлах); в тестах и `scripts/*.mjs` встречаются одиночные кавычки и точки с запятой (`scripts/check-version-parity.mjs`). Стиль не принуждается, поэтому файл-в-файл разнобой допустим.
- `any` формально не запрещён механически, но встречается точечно: 16 вхождений `as any`/`: any` в `src`+`app` без тестов, почти всё — иконки `@expo/vector-icons` и границы событий: `name={icon as any}` (`src/components/chat/ToolCallCard.tsx:358`), `(event as any).payload` (`src/stores/events.ts:642`). `AGENTS.md` требует «без `any`» — фактически это правило нарушается.
- TypeScript: `strict: true`, наследование `expo/tsconfig.base`, `allowImportingTsExtensions: true`, `types: ["node"]` (`tsconfig.json`). `include` — `**/*.ts` и `**/*.tsx`, поэтому `npm run typecheck` проверяет и тесты.
- Запуск: `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run check:versions`.
- Числа на 2026-11-15: **746 тестов**, покрытие **98.23 % строк / 86.16 % ветвей / 96.43 % функций**; `typecheck` — чисто.

### 3) Импорты и модули

- Порядок: внешние пакеты → внутренние модули; алфавитной сортировки нет, группировка не принуждается.
- Алиас `@/*` объявлен (`tsconfig.json`), но **не используется** (0 импортов `@/`): конвенция — относительные пути от файла (`../../src/stores/sessions` в `app/`, `./v2-compat` в `src/lib`).
- Общего барреля `src/index.ts` нет. Баррели есть только у двух каталогов компонентов: `src/components/chat/index.ts` (20 реэкспортов) и `src/components/markdown/index.tsx`.
- Тестовые файлы импортируют проверяемый модуль **с расширением `.ts`** (`import { keyboardPadding } from "./keyboard-inset.ts"`), production-код — без расширения. Это требование Node type-stripping'а (и `allowImportingTsExtensions` в tsconfig), а не вкусовщина.
- Чистый модуль (`src/lib/*.ts`) не должен импортировать `react-native`/`expo-*`, если для него планируются тесты под `node --test`; нативные обёртки выносятся отдельно (`src/lib/history-storage.ts` ↔ `src/lib/offline-history.ts`, `src/lib/speech.ts` ↔ `src/lib/speech-locale.ts`/`speech-errors.ts`, `src/lib/i18n/config.ts` ↔ `locale-resolve.ts`). Исключение — `src/lib/keep-alive.ts`: это тонкий мост к `NativeModules`, поэтому он тестируется статическим инвариантом (`src/lib/keep-alive-config.test.ts`), а не рендером.
- Type-only импорты помечаются `import type` (`src/stores/sessions.ts`).
- Нативные правки запрещено делать в `android/`: файл всё равно перезапишет `expo prebuild`. Место правки — `plugins/with-native-customizations.js` (или новый плагин), Kotlin-исходники — `plugins/native/**`; копии в `android/` считаются выводом, хотя и лежат в Git.

### 4) Ошибки и логирование

- Транспорт: не-2xx → `ApiError(status, body)`; 401/403 → auth-ошибка (`src/lib/api-error.ts`). Класс `ApiError` живёт в `api-error.ts`, а не в `sdk.ts`, чтобы оба транспорта делили его без цикла. 204/пустое тело → `undefined`; не-JSON → `ApiError(0, "Non-JSON response: …")`.
- Сторы: ошибки кладутся в строковое поле состояния (`error: string | null`) и/или логируются, наружу не пробрасываются, кроме `sendMessage`, где ошибка пробрасывается после очистки оптимистичного сообщения (`src/stores/sessions.ts (sendMessage)`). Ошибки конкретных сессий собираются в `sessionErrors` (`src/stores/events.ts:38`) — их читает строка сабагента.
- Fail-closed: недоступность, не-2xx и не-JSON трактуются как «сервер недоступен», успех требует явного признака (`src/lib/connection-health.ts`; `AGENTS.md`, раздел «Правила работы»).
- Логи: `console.log/warn/error` с тегом в квадратных скобках: `[SSE]`, `[Events]`, `[sendMessage]` (`src/stores/events.ts`, `src/lib/sdk.ts`). Плюс кольцевой буфер `src/lib/logbuffer.ts` (200 записей), который попадает в диагностический отчёт; пишутся только отказы и подавления уведомлений (`disabled`, `no-permission`, `held`, `deduped`, `failed`), не каждый успешный промпт.
- Секреты: пароли/`Authorization`/токены не логируются; отчёт для поддержки проходит через `redactHostAndUrls` (`src/lib/scrub.ts`, `src/lib/diagnostics.ts`). Инварианты закреплены статическими тестами `src/lib/security-baseline.test.ts`.
- Записи в SecureStore: пароли и офлайн-история — только с `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`src/stores/connections.ts:22`, `src/lib/history-storage.ts`); перечень разрешённых ключей — `src/lib/persisted-keys.test.ts`.
- Id из внешнего мира (deep link, payload уведомления) проверяются до подстановки в путь: `isSafeSessionId()` (`src/lib/session-id.ts`, алфавит `[A-Za-z0-9_-]{1,200}`).

### 5) Соглашения тестирования

- Каталог: тест лежит рядом с модулем (`src/lib/*.test.ts`), один тест — один файл модуля.
- Раннер: встроенный `node:test`, ассерты `node:assert/strict`; `describe/it` редки — почти всё плоские `test(...)`.
- Моки: внедрение зависимостей (фейковое хранилище, фейковый `fetch`), подмена `expo/fetch` через `registerHooks` (`src/lib/sdk.integration.test.ts`), HTTP-заглушка для интеграционных (`tests/fixtures/mock-opencode-server.ts`), «экранный» харнесс на `vm` + `typescript` (`src/lib/connections-screen.test.ts`), статические проверки исходников регулярками для того, что нельзя отрендерить (`src/lib/text-metrics.test.ts`, `src/components/wide-content-scroll.regression.test.ts`, `src/lib/keep-alive-config.test.ts`).
- Покрытие: гейт 80 % по строкам/ветвям/функциям (`package.json`); фактически 98.23 / 86.16 / 96.43 (прогон 2026-11-15).
- Чистые модули для Android-поведения: когда исправление целиком в нативном атрибуте (`lineHeight`, `nestedScrollEnabled`, `foregroundServiceType`), тест фиксирует инвариант по исходнику, а комментарий в тесте объясняет физику бага — см. `src/lib/text-metrics.test.ts`, `src/lib/scroll-config.test.ts`, `src/lib/keep-alive-config.test.ts`.
- Подробности — `docs/codebase/TESTING.md`.

### 6) Прочие наблюдаемые конвенции

- **Не задавать `lineHeight` тексту сообщений.** RN реализует его через `CustomLineHeightSpan`, который на последней строке приравнивает `fm.bottom` к `fm.descent`; у шрифта с глифами ниже descent срезается низ последней строки. В `src/components/markdown/Markdown.tsx` и `src/components/chat/MessageBubble.tsx` (стиль `messageText`) `lineHeight` намеренно отсутствует и закреплён тестом `src/lib/text-metrics.test.ts`.
- **Горизонтальный скролл широкого контента** (диффы, блоки кода) — только через `WIDE_CONTENT_SCROLL_CONFIG` (`src/lib/scroll-config.ts`), где `nestedScrollEnabled: true`; иначе вертикальный `FlatList` забирает жест. Тап по карточке инструмента сворачивает её только по заголовку — обёртка всей карточки в `TouchableOpacity` уже съедала жест (`src/components/chat/ToolCallCard.tsx`, `src/components/wide-content-scroll.regression.test.ts`).
- Комментарии объясняют «почему», часто со ссылкой на issue/BUG-номер (`BUG-029`, `issue #76`): `src/lib/notifications.ts` (BUG-029), `src/stores/events.ts` (issue #76), `src/lib/text-metrics.test.ts` (описание бага).
- Коммиты — Conventional Commits по факту истории: `feat(subagents): …`, `fix(chat): …`, `chore(release): 0.3.20`, `docs: …` (`git log`). Ветка — `main`.
- Локализация: только фиксированные ключи переводов, три каталога с паритетом ключей (`src/lib/i18n/catalog-parity.test.ts`); строки сервера как разметка не рендерятся (`AGENTS.md`). Заголовки и тела уведомлений теперь тоже ключи (`notifications.titles.*`, `notifications.bodies.*`, `notifications.keepAlive.*`), поэтому хардкода англоязычных заголовков больше нет.
- Тексты уведомлений о подтверждении и вопросе — константы-ключи `PERMISSION_NOTIFICATION_KEY` / `QUESTION_NOTIFICATION_KEY` (`src/lib/notify-format.ts`); серверные имена инструментов и текст вопроса в тело не попадают (аудит upstream M-03). Прочие тела проходят `sanitizeBody()` (снятие control-символов, лимит 200).
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
- `src/lib/session-id.ts`, `src/lib/settings-merge.ts`
- `src/lib/logbuffer.ts`
- `src/lib/scrub.ts`
- `src/lib/security-baseline.test.ts`
- `src/lib/persisted-keys.test.ts`
- `src/components/chat/index.ts`
- `src/components/markdown/index.tsx`
- `src/lib/i18n/catalog-parity.test.ts`
- `src/lib/connections-screen.test.ts`
- `src/lib/text-metrics.test.ts`, `src/lib/scroll-config.test.ts`, `src/lib/keep-alive-config.test.ts`
- `src/components/wide-content-scroll.regression.test.ts`
- `src/lib/notify-format.ts`, `src/lib/notifications.ts`
- `plugins/with-native-customizations.js`
- `AGENTS.md`
