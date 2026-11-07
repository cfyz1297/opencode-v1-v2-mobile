# Тестовые практики

Актуально на 2026-11-07, коммит `b0d31bc` (0.3.3).

## Обязательные разделы

### 1) Стек тестов и команды

- Основной фреймворк: **встроенный `node:test`** (без Jest/Vitest), запуск через `scripts/run-tests.mjs` на Node 24+ с нативным type-stripping — отдельной сборки тестов нет.
- Ассерты: `node:assert/strict`.
- Оркестрация: скрипт собирает файлы (`src/**/*.test.ts` + `scripts/*.test.mjs`), сортирует, передаёт явными аргументами и **падает с кодом 1, если файлов не найдено** — защита от «0 тестов = успех» (`scripts/run-tests.mjs`).
- Вспомогательные приёмы: `node:module` `registerHooks` (подмена `expo/fetch`), `node:vm` + пакет `typescript` (рендер экранов с детерминированными адаптерами), `readFileSync` (статический анализ исходников), `node:http` (настоящий loopback-сервер для транспортов).

```bash
npm test                 # 651 тест, 0 падений (2026-11-07)
npm run test:coverage    # + пороги 80 % (lines/branches/functions)
npm run typecheck        # tsc --noEmit (тесты входят в проверку)
npm run check:versions   # паритет версий
```

- Замеры 2026-11-07 (0.3.3): **tests 651 / pass 651 / fail 0**, покрытие **98.36 % строк, 86.22 % ветвей, 97.24 % функций**.
- Тесты используют реальные таймеры (sleep-ы в сотни мс, `node:vm`-рендер), поэтому под параллельной нагрузкой падают по таймауту без изменения кода. Перед выводом «тесты красные» перепроверять в простое.

### 2) Раскладка тестов

- Размещение: **рядом с модулем** — `src/lib/<name>.test.ts` для `src/lib/<name>.ts`. Исключения: `src/components/chat/diff-compute.test.ts`, `src/components/wide-content-scroll.regression.test.ts`, `src/components/chat/message-bubble-error.test.ts`, `src/lib/i18n/catalog-parity.test.ts`.
- Количество: **78 `.test.ts` в `src/` + 1 `.test.mjs` в `scripts/`** = 79 файлов.
- Суффиксы: `.regression.test.ts` (статический инвариант UI — `composer-taps`, `session-info`, `variant-picker-keyboard`, `dialog-back-gesture`, `tool-call-card`), `.integration.test.ts` (HTTP — `sdk`, `sdk-v1`, `session-list`, `providers-screen`), `.smoke.test.ts`.
- Setup-файлов и глобальных хуков нет: каждый тест сам поднимает окружение (`before`/`after` в `sdk.integration.test.ts`, `sdk-v1.integration.test.ts`).
- Отдельно от `npm test`: CUA smoke `scripts/cua-roadmap-smoke.mjs` — только в CI на эмуляторе.

### 3) Матрица охвата

| Область | Покрыто | Где | Заметки |
|---------|---------|-----|---------|
| Unit (чистая логика) | да, основное | `v2-compat`, `message-run`, `message-page`, `session-stats`, `tool-view`, `session-*`, watchdog'и, `offline-history`, `model-picker-filter`, `api-detect` | Большинство файлов `src/lib` — 100 % строк |
| Интеграционные HTTP | да | `sdk.integration.test.ts` (V2), **`sdk-v1.integration.test.ts` (V1, настоящий `node:http`-сервер)**, `session-list.integration.test.ts` | Проверяются пути, конверты, заголовки, курсы, отсутствие таймаута на prompt |
| Компонентные (рендер) | да, через харнесс | `connections-screen`, `models-screen`, `providers-screen.integration`, `provider-connect-screen.smoke` | `vm` + `typescript` с фейковыми RN/Expo/zustand |
| Статические инварианты | да | `security-baseline`, `persisted-keys`, `keyboard-inset` (часть), `dialog-back-gesture.regression`, `wide-content-scroll.regression`, `composer-taps.regression`, `session-info.regression`, `variant-picker-keyboard.regression`, `tool-call-card.regression`, `session-isolation` | Регулярки по исходникам: то, что нельзя отрендерить |
| E2E на устройстве | только в CI | `scripts/cua-roadmap-smoke.mjs` | Релизный APK + UIAutomator, API 35; в `npm test` не входит |
| Тесты против живого `opencode serve` | нет | — | V1 проверен против собственного мок-сервера с реальными путями и конвертами, но не против настоящего 1.18.x |

### 4) Моки и изоляция

- Основной подход: **внедрение зависимостей** вместо модульного мокинга. Чистые модули принимают хранилище/`fetch`/таймеры/`probe`: `createHistory(storage)`, `createPartBatcher(key, flush, delayMs)`, `createTunnelConnector(deps)`, `detectServerApi(probe)`, `parseStoredJSON(raw, fallback, label)`.
- Сетевой уровень: `registerHooks` подменяет только `expo/fetch` на глобальный `fetch`; сервер поднимается на `127.0.0.1:0` и пишет все вызовы в массив `calls` для ассертов (`sdk.integration.test.ts`, `sdk-v1.integration.test.ts`).
- HTTP-фикстура: `tests/fixtures/mock-opencode-server.ts` — минимальный сервер **V1**-протокола. С 0.3.0 это не мёртвый код: тот же V1-протокол обслуживает `createV1Client`, а `loadSessionList` теперь используется обоими транспортами.
- Двухпротокольные тесты: V1-клиент проверяется отдельным файлом со своим сервером — заголовки, Basic auth, `x-opencode-directory`, нормализация событий, курсор `x-next-cursor`, 404 on `/session/active`.
- UI-уровень: харнесс исполняет код экрана через `typescript.transpileModule` + `vm.runInNewContext` с управляемыми `useState`/`useEffect`/`useFocusEffect`.
- Хранилище: in-memory реализации `Storage`/`QueueStorage`.
- Частая ловушка: тест, читающий исходник регуляркой, ломается при рефакторинге формата, а не поведения — при правке таких файлов сохраняйте ожидаемый маркер осознанно.

### 5) Покрытие и сигналы качества

- Инструмент: `--experimental-test-coverage`; пороги 80 % строк/ветвей/функций; исключены `tests/**` и сами тесты (`package.json`).
- Текущее покрытие: **98.33 / 86.43 / 96.06**.
- Наиболее «дырявые» по ветвям: `src/lib/v2-compat.ts` и `src/lib/sdk.ts` — там живут непроверенные ветки протокола; `sdk-v1.ts` покрыт HTTP-тестами, но не всеми ошибками сети.
- Гейт в CI: job `test` выполняет `npm run check:versions` → `npm run typecheck` → `npm run test:coverage`, затем `build`.
- Известные пробелы: (1) `*.test.ts` исключены из `tsconfig.json` — `typecheck` не проверяет типы тестов; (2) нет тестов против живого сервера; (3) нет тестов на реальном устройстве (клавиатура, планшет, туннель) — только CUA smoke на эмуляторе.

### 6) Evidence

- `package.json` (`scripts.test`, `scripts.test:coverage`), `scripts/run-tests.mjs`, `scripts/run-tests.test.mjs`, `scripts/cua-roadmap-smoke.mjs`
- `.github/workflows/build.yml`, `tsconfig.json`
- `src/lib/sdk.integration.test.ts`, `src/lib/sdk-v1.integration.test.ts`, `src/lib/session-list.integration.test.ts`, `tests/fixtures/mock-opencode-server.ts`
- `src/lib/connections-screen.test.ts`, `src/lib/security-baseline.test.ts`, `src/lib/persisted-keys.test.ts`
- `src/lib/*.regression.test.ts`, `src/components/wide-content-scroll.regression.test.ts`
- `docs/codebase/.codebase-scan.txt`
