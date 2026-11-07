# Проблемные места кодовой базы

Зафиксировано 2026-11-07 на коммите `b0d31bc` (`main`, версия 0.3.3 / 68). Всё ниже — по факту кода и локальных прогонов, не по README.

## Обязательные разделы

### 1) Главные риски (по приоритету)

| Severity | Проблема | Evidence | Влияние | Что делать |
|----------|----------|----------|---------|------------|
| med | **Два транспорта — двойная площадь правки протокола.** Новое поле/событие нужно провести через `v2-compat.ts` и `sdk-v1.ts` | `src/lib/v2-compat.ts`, `src/lib/sdk-v1.ts` | Поле работает на одном поколении и молча пустое на другом | Таблица соответствия полей в `INTEGRATIONS.md` + тест на каждое новое поле в обоих файлах |
| med | **Определение API по конверту** опирается на поведение веб-интерфейса (неизвестный маршрут → `200 text/html`) | `src/lib/api-detect.ts` | Смена fallback-поведения сервера ломает автоподключение | Ручной переключатель уже есть; при смене — добавить проверку второго признака (например, `Server`-заголовок) |
| med | **Курсор сообщений V2 не листает** на проверенной сборке: `cursor.previous` отдаёт пустую страницу, обход останавливается | `src/lib/sdk.ts` (`allMessages`) | Фактический потолок «всей сессии» — 200 сообщений, хотя настройка обещает всю | Эскалировать в апстрим; сейчас ограничение осознанное и задокументировано в `HANDOFF.md` |
| med | **V1 не отдаёт `/api/session/active`** — «занятость» восстанавливается эвристикой по переписке | `src/lib/sdk-v1.ts` (`active` бросает 404), `src/stores/events.ts` | На длинном прогоне без событий возможен «вечный busy» | Добавить таймаут эвристики / считать прогон завершённым после N секунд тишины |
| med | Тесты опираются на реальные таймеры | `session-run-resync.test.ts` и др. | Ложные «красные» прогоны под нагрузкой | `--test-timeout` в `scripts/run-tests.mjs` или инъекция таймеров |
| med | Крупные экраны смешивают вёрстку, состояние и обработку протокола | `app/(tabs)/index.tsx` (1546), `app/session/[id].tsx` (1412) | Высокая цена изменений, регрессии при правке чата | Выносить обработчики в `src/lib` по образцу `message-run.ts`, `message-page.ts` |
| med | Файлы > 500 строк с несколькими ответственностями | `v2-compat.ts` (1024), `sdk.ts` (894), `events.ts` (661), `sessions.ts` (634) | Трудно менять одно, не задев другое | Разделить `v2-compat.ts` по доменам; вынести SSE из `sdk.ts` |
| med | `npm audit --omit=dev`: **34 записи (7 high)** в сборочной цепочке | локальный прогон 2026-11-05 | Только CI-раннер, не APK | Обновлять Expo/Metro; политика «не `audit fix --force`» (ломает Expo 54) |
| med | Биометрический лок ставится на `AppState === "background"`, не на `"inactive"` | `app/_layout.tsx`, `src/stores/auth.ts` | При некоторых сценариях переключения задач экран остаётся открытым | Ручная проверка на устройстве; при необходимости — таймаут бездействия |
| low | `global.health()` считает отсутствующий `healthy` за `true`, а `probeConnection` требует строго `true` | `src/lib/sdk.ts` (обе реализации), `src/lib/connection-health.ts` | Две семантики «здоровья» | Привести к fail-closed и покрыть тестом |
| low | 401/403 показывается как «Сервер недоступен» в бейдже статуса | `src/lib/connection-health.ts` | Пользователь не понимает, что дело в пароле | Отдельное состояние «неверный пароль» |
| low | Заголовки уведомлений захардкожены по-английски | `src/stores/events.ts` | На ru/zh уведомления на английском | Перенести в каталоги (тело уже фиксированное, см. `notify-format.ts`) |

### 2) Технический долг

Маркеров долга почти нет: скан находит **один** `TODO` (`src/components/chat/MessageBubble.tsx` — замена на streamdown-rn), `FIXME`/`HACK` отсутствуют.

| Долг | Почему существует | Где | Риск | Предлагаемое исправление |
|------|-------------------|-----|------|--------------------------|
| Нет линтера/форматтера | Полагались на `tsc` + тесты | весь репозиторий | Стилевой разнобой, мёртвые импорты ловятся глазами | ESLint + Prettier отдельным необязательным шагом |
| `@/*` алиас объявлен и не используется | Наследие шаблона | `tsconfig.json` | Ложное ожидание у нового участника | Использовать или удалить |
| `any` в десятках мест | Границы неполных внешних типов | `ToolCallCard.tsx`, `stores/events.ts`, тестовые хелперы | Ослабление `strict` на стыках | Уточнить типы событий/иконок |
| Остатки F-Droid в Gradle | Комментарии после отказа от F-Droid | `android/app/build.gradle` | Неочевидная причина `enableV3Signing false` | Обновить комментарии: совместимость подписи с 0.2.x–0.3.x |
| Дублирование семантики статуса сессии | Два источника (SSE и active) | `src/stores/events.ts` | Трудно воспроизводимые «вечный busy» | Задокументировать контракт, покрыть тестом приоритета |
| Таймеры сверки после отправки | V2 не шлёт событие о user-сообщении | `src/stores/sessions.ts` (1.2 с и 4 с) | Лишние GET; сообщение может «мигнуть» | Серверное событие/merge по id |
| Каталог `dist/` на диске разработчика | Локальные APK прошлых релизов | `dist/`, `.gitignore` | Изредка ловит невнимательный `git add -f` (уже случалось) | `dist/` в `.gitignore` (сделано), APK — только в GitHub Releases |

### 3) Безопасность

| Риск | OWASP | Evidence | Текущая мера | Пробел |
|------|-------|----------|--------------|--------|
| Пароль и переписка по plain `http://` | A02 | `app.json` (`usesCleartextTraffic`), `src/lib/connection-security.ts` | Предупреждение в формах; loopback/https не предупреждают | Запрета нет (осознанно); нет pinning/предупреждения о смене сертификата |
| `SYSTEM_ALERT_WINDOW` объявлен в prebuild-манифесте | A05 | `android/app/src/main/AndroidManifest.xml`, `app.json` (`blockedPermissions`) | Снимается при `expo prebuild`; инвариант в `security-baseline.test.ts` | Нет проверки **собранного** манифеста в CI |
| Хранение паролей/истории | A02 | `src/stores/connections.ts`, `src/lib/history-storage.ts` | `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, инвариант тестом | Нет явного исключения из Android-бэкапа для JSON соединений (URL!) |
| API-ключи провайдеров уходят на сервер | A04 | `src/lib/provider-auth.ts`, `src/lib/sdk-v1.ts` | Ключ не сохраняется клиентом; Basic-канал | При `http://` ключ виден в трафике |
| Ответы модели рендерятся как Markdown | A03 | `src/components/markdown/Markdown.tsx` | `react-native-marked` не исполняет HTML/JS | Нет теста «HTML в ответе не активен» |
| Серверный текст в уведомлениях | A09 (утечка на экран блокировки) | `src/lib/notify-format.ts`, `src/stores/events.ts` | **Исправлено в 0.3.0**: тело — фиксированные константы | — |
| Сверка сертификата в CI | A08 | `.github/workflows/build.yml` | `apksigner verify --print-certs` против закреплённого SHA-256 сертификата; APK предыдущего релиза больше не скачивается | При смене keystore константу нужно обновить вручную |
| Диагностические отчёты содержат хост сервера | A09 | `src/lib/diagnostics.ts` | Отчёт копируется/шарится только по нажатию пользователя; автоматической отправки нет | Редактирования нет — пользователь копирует текст вручную |
| HTML-страница читается как «живой сервер» | A08/A05 | `src/lib/diagnostics.ts`, `src/lib/diagnostics-classify.ts` | **Исправлено в 0.3.0**: `requireJson` + `chooseHealthProbe` | — |
| Туннель подменяет API своей страницей | — | `src/lib/headers.ts` | **Исправлено в 0.3.0**: `ngrok-skip-browser-warning`, `Bypass-Tunnel-Reminder` | — |

### 4) Производительность и масштабирование

| Проблема | Evidence | Симптом | Риск при росте | Улучшение |
|----------|----------|---------|----------------|-----------|
| «Вся сессия» тянет до 200 сообщений одним ответом | `src/lib/sdk.ts` (`allMessages`), `src/lib/message-page.ts` (`ALL_TURNS`) | Долгая загрузка длинных сессий | Память/трафик на мобильной сети | Починить курсор сообщений (сейчас ограничен 200) |
| Дозагрузка переписки на каждый «тихий» прогон | `src/lib/run-watchdog.ts`, `src/stores/events.ts` | Дублирующие GET при подвисшем прогоне | Несколько активных сессий = несколько тредов в полёте | Ограничить окно/батчить |
| Markdown перепарсивается на каждое обновление части | `src/components/chat/MessageBubble.tsx`, `src/components/markdown/Markdown.tsx` | Длинные ответы дорого ререндерятся | Фризы JS-потока | Батчинг есть; следующий шаг — мемоизация блоков |
| Адаптер событий хранит состояние по 400 сообщений | `src/lib/v2-compat.ts` | Память растёт, очистка O(n) | Очень длинные сессии | Ограничить по времени/сессии |
| `FlatList` без `getItemLayout` | `app/(tabs)/index.tsx`, `app/session/[id].tsx` | Прокрутка дёргается | Планшеты/большие сессии | `getItemLayout`, вынос компонентов |
| Офлайн-история пишется в SecureStore чанками | `src/lib/offline-history.ts`, `app/_layout.tsx` | Запись раз в секунду | Частые операции с Keystore | Увеличить дебаунс |
| Health-probe каждые 15 с на вкладке Connections | `app/(tabs)/connections.tsx` | Нагрузка на сервер в Termux | Батарея/сеть | Увеличить интервал |
| Переключение модели и агента последовательно перед промптом (V2) | `src/lib/sdk.ts` (`prompt`) | Два round-trip на первое сообщение | Задержка отправки | `Promise.all` |

Проверено обратное: основные «веерные» места распараллелены — `selectSession` (сессия + переписка), `loadConnections`, `useCatalog.load`, `refreshPending`, `resyncBusySessions`.

### 5) Хрупкие / высокочастотные области

Индекс churn: `git log --since="90 days ago" --name-only` (история короче 90 дней, окно покрывает все коммиты).

| Область | Почему хрупкая | Сигнал churn | Как менять безопасно |
|---------|----------------|--------------|----------------------|
| `README.md` / `README.ru.md` | Публичное лицо + changelog, две языковые версии | 29 / 10 | Править обе, сверять факты с `HANDOFF.md` |
| `package.json` | Версия, зависимости, скрипты | 28 | Версию — вместе с `app.json`, `build.gradle`, workflow; затем `check:versions` |
| `app.json` | Версия + versionCode + permissions + plugins | 27 | После правки — `expo prebuild` и проверка манифеста |
| `android/app/build.gradle` | Подпись, versionName/Code | 26 | Не трогать `signingConfigs` без проверки установки «поверх» |
| `HANDOFF.md` | Состояние, релизы, решения | 24 | Обновлять при каждом релизе и при найденном баге |
| `app/session/[id].tsx` | Чат: поток, клавиатура, композер, реверт, вложения, кольцо | 22 | Сначала тест в `src/lib`, потом правка экрана |
| `src/lib/sdk.ts` | Все endpoint'ы V2, таймауты, проба, курсоры | 17 | Любая правка — с HTTP-тестом в `sdk.integration.test.ts` |
| `src/lib/i18n/*.json` | Три каталога, паритет ключей | по 16 | Править все три сразу, иначе `catalog-parity` упадёт |
| `src/stores/sessions.ts` | Переписка, страницы, реверт, стоп | 13 | Тесты `message-page`, `session-*` |
| `src/stores/events.ts` | SSE, статусы, уведомления | 11 | Тесты `session-run-resync`, `events`-инварианты |
| `src/stores/connections.ts` | Клиент, проба, SecureStore | 10 | Тест `connection-bootstrap` |
| `src/lib/v2-compat.ts` | Единственное место знания о V2-пейлоадах | 10 | Правка — с `v2-compat.test.ts` |

### 6) `[ASK USER]` вопросы

1. `[ASK USER]` Оставлять ли GitHub Pages с унаследованным сайтом апстрима (`/privacy` описывает Sentry и VIBE TECHNOLOGIES LLC) — выключить, переписать под форк или оставить как исторический?
2. `[ASK USER]` Вводить ли ESLint + Prettier как обязательный гейт и с каким набором правил?
3. `[ASK USER]` Вычищать ли `SYSTEM_ALERT_WINDOW` из закоммиченного манифеста или достаточно `blockedPermissions`?
4. `[ASK USER]` Нужна ли поддержка V1-серверов **старше** 1.18.x (другой формат `permission.updated`)? Сейчас поддержаны два формата, более старые не проверялись.
5. `[ASK USER]` Обязателен ли V2 ≥ 2.0.24 с `/api/session/active`, или эвристику по переписке для старых V2 нужно сохранять бессрочно?
6. `[ASK USER]` Нужна ли iOS-сборка? `app.json` содержит полный iOS-блок, README утверждает, что iOS в форке нет.

### 7) Intent vs reality (расхождения документации и кода)

| Заявлено | Фактически | Evidence |
|----------|-----------|----------|
| README: «работает с opencode 1.x и 2.x» | Правда для транспортов; **живой сервер 1.18.x не проверялся** — только собственный мок-сервер с теми же путями | `src/lib/sdk-v1.integration.test.ts`, `HANDOFF.md` |
| README: «Вся» загружает весь транскрипт | Правда до 200 сообщений: курсор сообщений на проверенной сборке V2 не листает | `src/lib/sdk.ts` (`allMessages`) |
| README: «уведомления без серверного текста» | Верно для тела; **заголовок** по-прежнему английский хардкод | `src/lib/notify-format.ts`, `src/stores/events.ts` |
| AGENTS.md: «без `any`» | `as any`/`: any` встречаются | `ToolCallCard.tsx`, `stores/events.ts` |
| AGENTS.md: «фиксированные ключи переводов в UI» | Заголовки уведомлений — хардкод | `src/stores/events.ts` |
| AGENTS.md/HANDOFF местами описывают Windows-пути | Разработка идёт в Termux/Linux | `AGENTS.md`, `HANDOFF.md` |
| README: «34 записи в npm audit» | Совпадает (34, 7 high) | локальный прогон 2026-11-05 |
| README/`llms.txt`: «651 тест» | Совпадает | `npm test` 2026-11-07 |
| `.codebase-scan.txt`: «No security configs detected» | Есть gitleaks-workflow | `.github/workflows/security-scan.yml` |
| «APK не в Git» | Верно с 0.3.0 после чистки; в истории остались два APK из коммита `f8a2d20` (удалён из `main`, но объекты могут сохраняться на GitHub до GC) | `.gitignore`, `git log --all -- dist` |

### 8) Evidence

- `docs/codebase/.codebase-scan.txt` (TODO/FIXME, churn, top-10 largest, CI-детект)
- `git log --since="90 days ago" --name-only`
- `src/lib/sdk.ts`, `src/lib/sdk-v1.ts`, `src/lib/api-detect.ts`, `src/lib/v2-compat.ts`, `src/lib/message-page.ts`
- `src/stores/sessions.ts`, `src/stores/events.ts`, `src/stores/connections.ts`
- `app/(tabs)/index.tsx`, `app/session/[id].tsx`
- `tests/fixtures/mock-opencode-server.ts`, `src/lib/sdk-v1.integration.test.ts`
- `src/lib/offline-history.ts`, `src/lib/run-watchdog.ts`, `src/lib/stream-watchdog.ts`
- `.github/workflows/build.yml`, `.github/workflows/security-scan.yml`
- `tsconfig.json`, `package.json`, `app.json`, `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`
- `README.md`, `README.ru.md`, `HANDOFF.md`, `AGENTS.md`, `docs/security-review-server-api.md`
