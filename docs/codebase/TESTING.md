# Тестовые практики

Актуально на 2026-11-20, версия 0.3.22 / 87.

## Обязательные разделы

### 1) Стек тестов и команды

- Основной фреймворк: **встроенный `node:test`** (без Jest/Vitest), запуск через `scripts/run-tests.mjs` на Node 24+ с нативным type-stripping — отдельной сборки тестов нет.
- Ассерты: `node:assert/strict`.
- Оркестрация: скрипт собирает файлы (`src/**/*.test.ts` + `scripts/*.test.mjs`), сортирует, передаёт явными аргументами и **падает с кодом 1, если файлов не найдено** — защита от «0 тестов = успех» (`scripts/run-tests.mjs`).
- Вспомогательные приёмы: `node:module` `registerHooks` (подмена `expo/fetch`), `node:vm` + пакет `typescript` (рендер экранов с детерминированными адаптерами), `readFileSync` (статический анализ исходников), `node:http` (настоящий loopback-сервер для транспортов).

```bash
npm test                 # 852 теста, 0 падений (2026-11-20)
npm run test:coverage    # + пороги 80 % (lines/branches/functions)
npm run typecheck        # tsc --noEmit (тесты входят в проверку)
npm run check:versions   # паритет версий
```

- Замеры 2026-11-20 (0.3.22): **tests 852 / pass 852 / fail 0**, покрытие **98.27 % строк, 86.85 % ветвей, 96.75 % функций**; `typecheck` — чисто.
- Тесты используют реальные таймеры (sleep-ы в сотни мс, `node:vm`-рендер), поэтому под параллельной нагрузкой падают по таймауту без изменения кода. Перед выводом «тесты красные» перепроверять в простое. Полный прогон — около 3 минут.

### 2) Раскладка тестов

- Размещение: **рядом с модулем** — `src/lib/<name>.test.ts` для `src/lib/<name>.ts`. Исключения: `src/components/chat/diff-compute.test.ts`, `src/components/chat/message-bubble-error.test.ts`, `src/components/chat/activity-spoiler.test.ts`, `src/components/chat/message-navigation-layout.regression.test.ts`, `src/components/chat/session-banners-theme.test.ts`, `src/components/markdown/markdown-render.guards.test.ts`, `src/components/wide-content-scroll.regression.test.ts`, `src/components/markdown-inline-code.regression.test.ts`, `src/components/subagent-bar-theme.test.ts`, `src/lib/i18n/catalog-parity.test.ts`, `src/stores/catalog-failure.test.ts`.
- Количество: **115 `.test.ts` в `src/` + 2 `.test.mjs` в `scripts/`** = 117 файлов.
- Суффиксы: `.regression.test.ts` (13 файлов, статический инвариант UI — `composer-taps`, `session-info`, `session-header`, `variant-picker-keyboard`, `dialog-back-gesture`, `tool-call-card`, `update-banner`, `markdown-inline-code`, `wide-content-scroll`, `message-navigation-layout`, `subagent-resume`, `plain-transcript`, `text-selection-scroll`), `.integration.test.ts` (HTTP — `sdk`, `sdk-v1`, `session-list`, `providers-screen`), `.smoke.test.ts` (`providers-navigation`, `provider-connect-screen`).
- Явных setup-файлов и глобальных хуков нет: каждый тест сам поднимает окружение (`before`/`after` в `sdk.integration.test.ts`, `sdk-v1.integration.test.ts`).
- Отдельно от `npm test`: CUA smoke `scripts/cua-roadmap-smoke.mjs` — только в CI на эмуляторе (API 35).
- `src/lib/keep-alive.test.ts` работает без нативного модуля: мост подменяется фейком через `NativeModules`, `AppRegistry` — заглушками; нативная часть (`foregroundServiceType`, `START_NOT_STICKY`, `specialUse`) проверяется статически в `src/lib/keep-alive-config.test.ts`.

### 3) Матрица охвата

| Область | Покрыто | Где | Заметки |
|---------|---------|-----|---------|
| Unit (чистая логика) | да, основное | `v2-compat`, `transcript-rows`, `part-runs`, `message-navigation`, `tool-summary`, `tool-duration`, `markdown-keys`, `disconnect-reason`, `message-run`, `message-page`, `session-stats`, `tool-view`, `subagent-status`, `session-*`, watchdog'и, `offline-history`, `model-picker-filter`, `api-detect`, `keep-alive` | Большинство файлов `src/lib` — 100 % строк |
| Уведомления | да | `notifications-send`, `notification-icons`, `notify-format`, `question-event`, `composer-and-questions` | Проверяются отложенные/дедуп/категории, а не системная шторка |
| Интеграционные HTTP | да | `sdk.integration.test.ts` (V2), **`sdk-v1.integration.test.ts` (V1, настоящий `node:http`-сервер)**, `session-list.integration.test.ts` | Проверяются пути, конверты, заголовки, курсы, отсутствие таймаута на prompt |
| Компонентные (рендер) | да, через харнесс и статические инварианты | `connections-screen`, `models-screen`, `providers-screen.integration`, `provider-connect-screen.smoke`, `subagent-bar-theme` | `vm` + `typescript` с фейковыми RN/Expo/zustand; для JSX-тем — чтение исходника |
| Статические инварианты | да | `security-baseline`, `persisted-keys`, `text-metrics`, `scroll-config`, `keep-alive-config`, `mic-permission-config`, `sheet-library-version`, `session-isolation`, `markdown-render.guards`, `activity-spoiler`, `message-navigation-layout`, `session-banners-theme`, `*.regression` | Регулярки по исходникам: то, что нельзя отрендерить (обрезка строки, nested scroll, FGS-тип, RECORD_AUDIO, эффект библиотеки без зависимостей) |
| Прокрутка ленты | да, юнит + исходник | `src/lib/scroll-follow.test.ts` (`isNearBottom`, `endScrollOffset`, `followScrollOffset`, границы `FOLLOW_TO_END`), `src/components/chat/plain-transcript.regression.test.ts`, `src/components/chat/text-selection-scroll.regression.test.ts` | Порядок ленты, владение позицией жестом, отсутствие прямого `scrollToEnd`, переякорь по `onLayout` и `scrollsChildToFocus={false}`. Проверяется исходник, а не живая прокрутка: поведение на устройстве ловит только CUA smoke |
| E2E на устройстве | только в CI | `scripts/cua-roadmap-smoke.mjs` | Релизный APK + UIAutomator, API 35; в `npm test` не входит |
| Тесты против живого `opencode serve` | нет | — | V1 проверен против собственного мок-сервера с реальными путями и конвертами, но не против настоящего 1.18.x; V2 вручную проверялся на живом 2.x |

### 4) Моки и изоляция

- Основной подход: **внедрение зависимостей** вместо модульного мокинга. Чистые модули принимают хранилище/`fetch`/таймеры/`probe`: `createHistory(storage)`, `createPartBatcher(key, flush, delayMs)`, `createTunnelConnector(deps)`, `detectServerApi(probe)`, `parseStoredJSON(raw, fallback, label)`.
- Сетевой уровень: `registerHooks` подменяет только `expo/fetch` на глобальный `fetch`; сервер поднимается на `127.0.0.1:0` и пишет все вызовы в массив `calls` для ассертов (`sdk.integration.test.ts`, `sdk-v1.integration.test.ts`).
- HTTP-фикстура: `tests/fixtures/mock-opencode-server.ts` — минимальный сервер **V1**-протокола. С 0.3.0 это не мёртвый код: тот же V1-протокол обслуживает `createV1Client`, а `loadSessionList` теперь используется обоими транспортами.
- Двухпротокольные тесты: V1-клиент проверяется отдельным файлом со своим сервером — заголовки, Basic auth, `x-opencode-directory`, нормализация событий, курсор `x-next-cursor`, 404 on `/session/active`.
- Нативные мосты: `NativeModules.KeepAlive` / `NativeModules.Notify` подменяются фейковыми объектами — тесты в `npm test` не требуют Android.
- UI-уровень: харнесс исполняет код экрана через `typescript.transpileModule` + `vm.runInNewContext` с управляемыми `useState`/`useEffect`/`useFocusEffect`.
- Хранилище: in-memory реализации `Storage`/`QueueStorage`.
- Частая ловушка: тест, читающий исходник регуляркой, ломается при рефакторинге формата, а не поведения — при правке таких файлов сохраняйте ожидаемый маркер осознанно.

### 5) Покрытие и сигналы качества

- Инструмент: `--experimental-test-coverage`; пороги 80 % строк/ветвей/функций; исключены `tests/**` и сами тесты (`package.json`).
- Текущее покрытие: **98.27 / 86.85 / 96.75** (2026-11-20).
- Наиболее «дырявые» по ветвям: `src/lib/v2-compat.ts` и `src/lib/sdk.ts` — там живут непроверенные ветки протокола; `sdk-v1.ts` покрыт HTTP-тестами, но не всеми ошибками сети.
- Гейт в CI: job `test` выполняет `npm run check:versions` → `npm run typecheck` → `npm run test:coverage`, затем `build`; `roadmap-smoke` запускает CUA-эмулятор.
- Канарейки против сторонних библиотек: `markdown-render.guards.test.ts` читает установленный `MDImage` и падает, когда библиотека сама ограничит эффект, — сигнал убрать наше переопределение. Тот же приём годится для любой другой подмены.
- Известные пробелы: (1) нет тестов против живого сервера; (2) нет тестов на реальном устройстве (клавиатура, планшет, туннель, фоновая доставка уведомлений) — только CUA smoke на эмуляторе; (3) нативные мосты тестируются фейками, поэтому расхождение с Kotlin ловится только CI-проверкой собранного APK.

### 6) Evidence

- `package.json` (`scripts.test`, `scripts.test:coverage`), `scripts/run-tests.mjs`, `scripts/run-tests.test.mjs`, `scripts/cua-roadmap-smoke.mjs`
- `.github/workflows/build.yml`, `tsconfig.json`
- `src/lib/sdk.integration.test.ts`, `src/lib/sdk-v1.integration.test.ts`, `src/lib/session-list.integration.test.ts`, `tests/fixtures/mock-opencode-server.ts`
- `src/lib/connections-screen.test.ts`, `src/lib/security-baseline.test.ts`, `src/lib/persisted-keys.test.ts`
- `src/lib/text-metrics.test.ts`, `src/lib/keep-alive.test.ts`, `src/lib/keep-alive-config.test.ts`, `src/lib/notifications-send.test.ts`, `src/lib/subagent-status.test.ts`
- `src/lib/transcript-rows.test.ts`, `src/lib/part-runs.test.ts`, `src/lib/message-navigation.test.ts`, `src/lib/message-navigation-step.test.ts`, `src/lib/message-navigation-visible.test.ts`, `src/lib/scroll-follow.test.ts`, `src/lib/tool-summary.test.ts`, `src/lib/markdown-keys.test.ts`
- `src/components/chat/plain-transcript.regression.test.ts`, `src/components/chat/text-selection-scroll.regression.test.ts`
- `src/components/markdown/markdown-render.guards.test.ts`, `src/components/chat/activity-spoiler.test.ts`, `src/components/chat/message-navigation-layout.regression.test.ts`
- `src/lib/*.regression.test.ts`, `src/components/wide-content-scroll.regression.test.ts`, `src/components/markdown-inline-code.regression.test.ts`
- `docs/codebase/.codebase-scan.txt`
