# OpenCode V1/V2 Mobile — AGENTS.md

Форк `cfyz1297/opencode-v1-v2-mobile` (до 0.3.0 — `opencode-mobile`): Expo/React Native Android-клиент к собственному серверу `opencode serve`. Работает с **обоими поколениями API**: V1 (opencode 1.18.x, `/session`, `/global/*`) и V2 (opencode 2.x, `/api/*`); версия определяется автоматически при подключении (`src/lib/api-detect.ts`), переключатель — Настройки → Сервер → API сервера. Приложение не публикуется в магазинах — только APK через GitHub Releases. Текущее состояние, версия и порядок релиза: [HANDOFF.md](HANDOFF.md). Уроки прошлых задач: [.agents/retro.md](.agents/retro.md). Карта кодовой базы: [docs/codebase/](docs/codebase/) (снимок; свежесть — `docs/codebase/.map-head`).

## Карта проекта

```
app/                 # Expo Router: (tabs)/sessions|connections|settings, session/[id], connection/, models, providers/, history, demo
src/lib/             # оба транспорта (sdk.ts V2, sdk-v1.ts V1, api-detect.ts), адаптер V2→V1 (v2-compat.ts),
                     #   чистая логика: message-page, session-stats, tool-view, session-*, watchdog'и + тесты рядом (*.test.ts)
src/stores/          # zustand: sessions, connections, events (SSE), catalog, settings, auth, model-visibility, model-favorites
src/components/      # UI: chat/ (включая ContextRing, SessionInfo, ToolCallCard), markdown/, AuthGate, TabletSessions, UpdateBanner
android/             # prebuild-вывод, подпись и сборка релиза (gradlew assembleRelease)
scripts/             # run-tests.mjs, check-version-parity.mjs, cua-roadmap-smoke.mjs
docs/                # отчёты (security ×2, upstream review, проверки) + docs/codebase/ — карта кодовой базы
```

## Команды

```bash
npm run check:versions   # package.json ↔ app.json ↔ android/app/build.gradle
npm run typecheck
npm test                 # node --test через scripts/run-tests.mjs (651 тест на 0.3.3)
npm run test:coverage    # пороги 80% по строкам/ветвям/функциям
npm run android          # dev-сборка на устройстве/эмуляторе
```

Перед ответом «готово» прогонять `check:versions`, `typecheck`, `test:coverage`. Тесты — только через `npm test`/`run-tests.mjs` (glob-ы в оболочке ломаются).

## Правила работы

- Новая функция или багфикс — сначала падающий тест (RED), потом минимальный фикс (GREEN). UI-тесты для экранов запускают настоящий компонент с детерминированными адаптерами RN (образец: `src/lib/connections-screen.test.ts`); для того, что нельзя отрендерить, — статический инвариант по исходнику (`*.regression.test.ts`).
- Чистую логику выносить в `src/lib/*.ts` без импортов RN/SDK, чтобы тестировать обычным `node --test`.
- **Любое изменение протокола трогает два файла:** поле сессии/события нужно провести и через `src/lib/v2-compat.ts` (V2), и через `src/lib/sdk-v1.ts` (V1). Компилятор ловит расхождение типов, но не поведения — каждое новое поле покрывать тестом в обоих (`sdk.integration.test.ts`, `sdk-v1.integration.test.ts`).
- Неизвестный маршрут на обоих поколениях отвечает `200 text/html` из веб-интерфейса: определение версии — по телу и `content-type`, никогда по коду ответа.
- Секреты никогда не попадают в код, тесты, логи и коммиты. Пароли серверов — только SecureStore с `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- Ответы сервера не рендерить как разметку и не логировать; в UI — фиксированные ключи переводов (en/ru/zh-Hans, паритет проверяется тестом). Тексты уведомлений о подтверждении и вопросе — фиксированные константы в `src/lib/notify-format.ts`, серверный текст в шторку не попадает.
- Fail-closed: недоступность, ошибка сети и не-2xx трактуются как «сервер недоступен», а не как успех.
- Стиль: `const`, ранние возвраты, минимальный диф; комментарий объясняет «почему», а не «что».
- Текст релиза (GitHub Release, README, HANDOFF) — на двух языках: сначала английский, затем русский.

## Git и CI

- `gh` CLI авторизован как `cfyz1297`, scopes `repo, workflow, gist, read:org`. Пуш в `.github/workflows/*` требует scope `workflow` — проверять `gh auth status` перед правкой workflow.
- Активны только workflow `Build Android APK` и `Security scan`. Всё остальное (магазины, iOS, Maestro) из проекта удалено.
- Версия живёт в трёх местах: `package.json`, `app.json` (version + versionCode) и `android/app/build.gradle`. `check:versions` проверяет их; workflow берёт ожидаемые значения из `app.json`, литералы в нём больше не дублируются.
- Релиз: тег `vX.Y.Z` → GitHub Release с `opencode-mobile-v2.apk` + `SHA256SUMS.txt`; предыдущему релизу добавить строку «⚠️ Устарел — используйте vX.Y.Z». Имя APK не меняется: на него опираются встроенная проверка обновлений и сверка подписи в CI.
- `dist/` — локальные APK, в Git не попадают (`dist/` в `.gitignore`). APK публикуется только ассетом релиза; `git add -A -f` в этом репозитории опасен — однажды затащил два APK в историю.
