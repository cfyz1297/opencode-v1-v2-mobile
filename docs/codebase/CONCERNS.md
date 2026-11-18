# Проблемные места кодовой базы

Зафиксировано 2026-11-18 на версии 0.3.21 / 86 (релизный коммит `6e5a88f`). Всё ниже — по факту кода и локальных прогонов, не по README.

## Закрыто в 0.3.21

- **Ошибка стора не рендерилась.** `useSessions.error` писался в пятнадцати местах и не показывался нигде; теперь баннер с текстом, следующим шагом, «Копировать» и «Скрыть» (`app/session/[id].tsx`, гвард `message-navigation-theme`/`session-banners-theme`).
- **Длительность инструментов терялась при переоткрытии.** Маппер истории выбрасывал `time` tool-части; теперь `toolTime()` в `v2-compat.ts` переносит `{created, ran, completed}` в `state.time`.
- **V1-поток мог висеть после «подключено».** У V1 не было срока на рукопожатие SSE; теперь общий `dialStream()` с `CONNECT_TIMEOUT_MS`.
- **Обновление при возврате в приложение обрезало ленту до 50 сообщений** и теряло карточки сабагентов; закрыто `keepLoadedHistory` + страница по настройке, инварианты `session-refresh-page.test.ts`.

## Обязательные разделы

### 1) Главные риски (по приоритету)

| Severity | Проблема | Evidence | Влияние | Что делать |
|----------|----------|----------|---------|------------|
| med | **Два транспорта — двойная площадь правки протокола.** Новое поле/событие нужно провести через `v2-compat.ts` и `sdk-v1.ts` | `src/lib/v2-compat.ts`, `src/lib/sdk-v1.ts` | Поле работает на одном поколении и молча пустое на другом | Таблица соответствия полей в `INTEGRATIONS.md` + тест на каждое новое поле в обоих файлах |
| med | **Сабагенты на V1 неполные.** `client.session.children` есть только у V2, `loadChildren` глотает исключение | `src/lib/sdk.ts:482`, `src/stores/sessions.ts:197` | На V1 дочерние сессии не подгружаются; счётчики живут на событиях и tool-частях | Решить, нужен ли аналог на V1, или явно скрывать панель при `api === "v1"` |
| med | **Определение API по конверту** опирается на поведение веб-интерфейса (неизвестный маршрут → `200 text/html`) | `src/lib/api-detect.ts` | Смена fallback-поведения сервера ломает автоподключение | Ручной переключатель уже есть; при смене — добавить второй признак (например, `Server`-заголовок) |
| med | **Курсор сообщений V2 не листает** на проверенной сборке: `cursor.previous` отдаёт пустую страницу, обход останавливается | `src/lib/sdk.ts` (`allMessages`) | Фактический потолок «всей сессии» — 200 сообщений, хотя настройка обещает всю | Эскалировать в апстрим; сейчас ограничение осознанное |
| med | **Навигатор зависит от разложенных ячеек.** Позиция считается по кадрам `CellRendererComponent`; строка вне окна рендера не измерена, и для неизвестной позиции принимается «самое новое сообщение» | `src/lib/message-navigation.ts`, `app/session/[id].tsx` (`measureCell`) | Счётчик может показать последнее сообщение, пока лента ещё монтируется | Не менять без нужды: `onViewableItemsChanged` не срабатывает до первого скролла, а `onLayout` строки даёт `y = 0` относительно ячейки |
| low | **Markdown-подмены зависят от версии библиотеки.** Свой `MarkdownImage` и счётчик ключей нужны, пока `react-native-marked` не ограничит эффект и не уберёт `github-slugger` | `src/components/markdown/MarkdownImage.tsx`, `src/lib/markdown-keys.ts` | При обновлении библиотеки подмена может стать лишней или несовместимой | `markdown-render.guards.test.ts` канарейкой читает установленный `MDImage` и падает, когда подмена больше не нужна |
| med | **V1 не отдаёт `/api/session/active`** — «занятость» восстанавливается эвристикой по переписке | `src/lib/sdk-v1.ts` (`active` бросает 404), `src/stores/events.ts` | На длинном прогоне без событий возможен «вечный busy» | Добавить таймаут эвристики / считать прогон завершённым после N секунд тишины |
| med | **Фоновое удержание зависит от политики Android.** `dataSync` ограничен 6 ч за 24 на Android 15, сервис объявлен как `dataSync\|specialUse` | `plugins/native/keepalive/KeepAliveService.kt`, `plugins/with-native-customizations.js:202` | Долгий фон без `specialUse` (API < 34) может быть убит системой; после `onTimeout` уведомления замолкают | Проверить на устройстве Android 15–16; следить за изменениями FGS-политики |
| med | **Фоновый опрос каждые 5 с** (плюс foreground-сервис) | `BACKGROUND_POLL_MS` (`src/stores/events.ts:404`) | Батарея и трафик на длинных прогонах | Адаптивный интервал / опора на SSE, когда сокет жив |
| med | Тесты опираются на реальные таймеры | `session-run-resync.test.ts` и др. | Ложные «красные» прогоны под нагрузкой (~3 мин полный прогон) | `--test-timeout` в `scripts/run-tests.mjs` или инъекция таймеров |
| med | Крупные экраны смешивают вёрстку, состояние и обработку протокола | `app/(tabs)/index.tsx` (1546), `app/session/[id].tsx` (1922) | Высокая цена изменений, регрессии при правке чата | Выносить обработчики в `src/lib` по образцу `message-run.ts`, `transcript-rows.ts`, `message-navigation.ts` |
| med | Файлы > 500 строк с несколькими ответственностями | `v2-compat.ts` (1064), `events.ts` (922), `sdk.ts` (870), `sessions.ts` (695) | Трудно менять одно, не задев другое | Разделить `v2-compat.ts` по доменам; вынести SSE из `sdk.ts` и фоновый опрос из `events.ts` |
| med | `npm audit --omit=dev`: **3 moderate** в сборочной цепочке (было 34 / 7 high на 0.3.3) | локальный прогон 2026-11-15 | Только CI-раннер, не APK | Обновлять Expo/Metro; политика «не `audit fix --force`» (ломает Expo) |
| low | Биометрический лок ставится на `AppState === "background"`, не на `"inactive"` — это осознанно, чтобы не лочиться на системном промпте | `app/_layout.tsx:99-105` | При некоторых сценариях переключения задач экран остаётся открытым | Ручная проверка на устройстве; при необходимости — таймаут бездействия |
| low | `global.health()` считает отсутствующий `healthy` за `true`, а `probeConnection` требует строго `true` | `src/lib/sdk.ts`, `src/lib/connection-health.ts` | Две семантики «здоровья» | Привести к fail-closed и покрыть тестом |
| low | 401/403 показывается как «Сервер недоступен» в бейдже статуса | `src/lib/connection-health.ts` | Пользователь не понимает, что дело в пароле | Отдельное состояние «неверный пароль» |
| low | Скрытие карточки foreground-сервиса — трюк с каналом `IMPORTANCE_NONE` | `plugins/native/keepalive/KeepAliveService.kt` | Важность канала нельзя изменить после создания; старый канал удаляется и создаётся заново | Оставить как есть, пока Android требует карточку для FGS |

### 2) Технический долг

Маркеров долга почти нет: скан находит **один** `TODO` (`src/components/chat/MessageBubble.tsx:42` — замена на streamdown-rn), `FIXME`/`HACK` отсутствуют.

| Долг | Почему существует | Где | Риск | Предлагаемое исправление |
|------|-------------------|-----|------|--------------------------|
| Нет линтера/форматтера | Полагались на `tsc` + тесты | весь репозиторий | Стилевой разнобой, мёртвые импорты ловятся глазами | ESLint + Prettier отдельным необязательным шагом |
| `@/*` алиас объявлен и не используется | Наследие шаблона | `tsconfig.json` | Ложное ожидание у нового участника | Использовать или удалить |
| `any` в десятках мест | Границы неполных внешних типов | `ToolCallCard.tsx:358`, `stores/events.ts:642`, `speech.ts:70` | Ослабление `strict` на стыках | Уточнить типы событий/иконок |
| Остатки F-Droid в настройках подписи | Комментарии после отказа от F-Droid | `plugins/with-native-customizations.js:22-31` | Неочевидная причина `enableV3Signing false` | Обновить комментарии: совместимость подписи с 0.2.x–0.3.x |
| Дублирование семантики статуса сессии | Два источника (SSE и active/опрос) | `src/stores/events.ts` | Трудно воспроизводимые «вечный busy» | Задокументировать контракт, покрыть тестом приоритета |
| Таймеры сверки после отправки | V2 не шлёт событие о user-сообщении | `src/stores/sessions.ts` (1.2 с и 4 с) | Лишние GET; сообщение может «мигнуть» | Серверное событие/merge по id |
| Каталог `dist/` на диске разработчика | Локальные APK прошлых релизов | `dist/`, `.gitignore` | Изредка ловит невнимательный `git add -f` (уже случалось) | `dist/` в `.gitignore` (сделано), APK — только в GitHub Releases |
| Сгенерированный `android/` лежит в Git рядом с `plugins/native/` | Prebuild-вывод коммитится для сборки без prebuild | `android/app/src/main/java/.../keepalive/*.kt` × `plugins/native/keepalive/*.kt` | Две копии Kotlin могут разойтись, если править не тот файл | Периодически сверять `diff -r`; правило зафиксировано в CONVENTIONS |

### 3) Безопасность

| Риск | OWASP | Evidence | Текущая мера | Пробел |
|------|-------|----------|--------------|--------|
| Пароль и переписка по plain `http://` | A02 | `app.json` (`usesCleartextTraffic` через плагин), `src/lib/connection-security.ts` | Предупреждение в формах; loopback/https не предупреждают | Запрета нет (осознанно); нет pinning/предупреждения о смене сертификата |
| `SYSTEM_ALERT_WINDOW` объявлен в prebuild-манифесте | A05 | `android/app/src/main/AndroidManifest.xml`, `app.json` (`blockedPermissions`) | Снимается при `expo prebuild`; инвариант в `security-baseline.test.ts`; CI проверяет **собранный** APK (`aapt dump permissions`) | — |
| Хранение паролей/истории | A02 | `src/stores/connections.ts`, `src/lib/history-storage.ts` | `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, инвариант тестом | Нет явного исключения из Android-бэкапа для JSON соединений (URL!) |
| API-ключи провайдеров уходят на сервер | A04 | `src/lib/provider-auth.ts`, `src/lib/sdk-v1.ts` | Ключ не сохраняется клиентом; Basic-канал | При `http://` ключ виден в трафике |
| Ответы модели рендерятся как Markdown | A03 | `src/components/markdown/Markdown.tsx` | `react-native-marked` не исполняет HTML/JS | Нет теста «HTML в ответе не активен» |
| Id сессии из deep link / уведомления | A03 | `src/lib/session-id.ts` | `isSafeSessionId` — алфавит и длина до подстановки в путь | — |
| Серверный текст в уведомлениях | A09 (утечка на экран блокировки) | `src/lib/notify-format.ts`, `src/stores/events.ts` | Тела подтверждения/вопроса — фиксированные ключи; прочие проходят `sanitizeBody` (control-символы, 200 символов) | — |
| Сверка сертификата в CI | A08 | `.github/workflows/build.yml` | `apksigner verify --print-certs` против закреплённого SHA-256; APK предыдущего релиза не скачивается | При смене keystore константу нужно обновить вручную |
| Диагностические отчёты содержат хост сервера | A09 | `src/lib/diagnostics.ts` | Отчёт копируется/шарится только по нажатию; `redactHostAndUrls` | Пользователь копирует текст вручную |
| HTML-страница читается как «живой сервер» | A08/A05 | `src/lib/diagnostics.ts`, `src/lib/diagnostics-classify.ts` | `requireJson` + `chooseHealthProbe` | — |
| Туннель подменяет API своей страницей | — | `src/lib/headers.ts` | `ngrok-skip-browser-warning`, `Bypass-Tunnel-Reminder` | — |

### 4) Производительность и масштабирование

| Проблема | Evidence | Симптом | Риск при росте | Улучшение |
|----------|----------|---------|----------------|-----------|
| «Вся сессия» тянет до 200 сообщений одним ответом | `src/lib/sdk.ts` (`allMessages`), `src/lib/message-page.ts` (`ALL_TURNS`) | Долгая загрузка длинных сессий | Память/трафик на мобильной сети | Починить курсор сообщений (сейчас ограничен 200) |
| Фоновый опрос `/api/session/active` каждые 5 с | `src/stores/events.ts:404-490` | Постоянный трафик и пробуждения в фоне | Батарея | Интервал по числу активных сессий, остановка при живом SSE |
| Дозагрузка переписки на каждый «тихий» прогон | `src/lib/run-watchdog.ts`, `src/stores/events.ts` | Дублирующие GET при подвисшем прогоне | Несколько активных сессий = несколько тредов в полёте | Ограничить окно/батчить |
| `sessionErrors`/`sessionStatus` не чистятся при удалении сессии | `src/stores/events.ts:38,914-919` | Память на много сессий | Долгая сессия с десятками детей | Сбрасываются только при новом прогоне и `disconnect`; чистить по удалению сессии |
| Markdown перепарсивается на каждое обновление части | `src/components/chat/MessageBubble.tsx`, `src/components/markdown/Markdown.tsx` | Длинные ответы дорого ререндерятся | Фризы JS-потока | Батчинг есть; следующий шаг — мемоизация блоков |
| Адаптер событий хранит состояние по 400 сообщений | `src/lib/v2-compat.ts:627` (`MAX_TRACKED`) | Память растёт, очистка O(n) | Очень длинные сессии | Ограничить по времени/сессии |
| `FlatList` без `getItemLayout` | `app/(tabs)/index.tsx`, `app/session/[id].tsx` | Прокрутка дёргается | Планшеты/большие сессии | `getItemLayout`, вынос компонентов |
| Офлайн-история пишется в SecureStore чанками | `src/lib/offline-history.ts`, `app/_layout.tsx` | Запись раз в секунду | Частые операции с Keystore | Увеличить дебаунс |
| Health-probe каждые 15 с на вкладке Connections | `app/(tabs)/connections.tsx:18` (`PROBE_INTERVAL_MS`) | Нагрузка на сервер в Termux | Батарея/сеть | Увеличить интервал |
| Переключение модели и агента последовательно перед промптом (V2) | `src/lib/sdk.ts` (`prompt`) | Два round-trip на первое сообщение | Задержка отправки | `Promise.all` |

Проверено обратное: основные «веерные» места распараллелены — `selectSession` (сессия + переписка), `loadConnections`, `useCatalog.load`, `refreshPending`, `resyncBusySessions`.

### 5) Хрупкие / высокочастотные области

Индекс churn: `git log --since="90 days ago" --name-only`. Клон в этой рабочей копии **shallow** (`.git/shallow`, 186 видимых коммитов с 2026-10-20), поэтому окно покрывает всю доступную историю; для полной истории нужен `git fetch --unshallow`.

| Область | Почему хрупкая | Сигнал churn | Как менять безопасно |
|---------|----------------|--------------|----------------------|
| `package.json` | Версия, зависимости, скрипты | 64 | Версию — вместе с `app.json`, `build.gradle`; затем `check:versions` |
| `app.json` | Версия + versionCode + permissions + plugins + порядок плагинов | 63 | После правки — `expo prebuild` и проверка манифеста; порядок плагинов важен (иконка уведомлений) |
| `android/app/build.gradle` | Сгенерирован prebuild'ом | 62 | Правки — только через `plugins/with-native-customizations.js` |
| `HANDOFF.md` | Журнал состояния и релизов | 47 | Обновлять при каждом релизе; статусная таблица уже отстала (см. §7) |
| `README.md` / `README.ru.md` | Публичное лицо + changelog, две языковые версии | 39 / 21 | Править обе; сверять факты с кодом, не с HANDOFF |
| `app/session/[id].tsx` | Чат: поток, клавиатура, композер, реверт, вложения, кольцо, сабагенты, навигатор | 47 | Сначала тест в `src/lib`, потом правка экрана |
| `.github/workflows/build.yml` | Тесты, сборка, проверки APK, CUA | 28 | Ожидаемые версии читать из `app.json`; проверять на пуше |
| `src/lib/i18n/*.json` | Три каталога, паритет ключей | по 24 | Править все три сразу, иначе `catalog-parity` упадёт |
| `src/stores/events.ts` | SSE, статусы, фон, уведомления, сабагенты | 20 | Тесты `session-run-resync`, `notification-icons`, `question-event` |
| `src/lib/sdk.ts` | Все endpoint'ы V2, таймауты, проба, курсоры | 20 | Любая правка — с HTTP-тестом в `sdk.integration.test.ts` |
| `scripts/cua-roadmap-smoke.mjs` | E2E-сценарий на эмуляторе | 50 | Проверять локально невозможно — полагаться на CI-прогон; каждый дамп uiautomator стоит ~1.5 с, а панель навигатора живёт 3.5 с |
| `src/stores/sessions.ts` | Переписка, страницы, реверт, стоп, дети | 17 | Тесты `message-page`, `session-*` |
| `src/lib/v2-compat.ts` | Единственное место знания о V2-пейлоадах | 13 | Правка — с `v2-compat.test.ts` |
| `app/_layout.tsx` | Порядок инициализации, фон, биометрия, deep links | 13 | Не менять порядок settings → connections |

### 6) `[ASK USER]` вопросы

1. `[ASK USER]` Нужна ли панель сабагентов на V1-подключениях, если дочерние сессии там не запрашиваются (только tool-части и события)?
2. `[ASK USER]` Вводить ли ESLint + Prettier как обязательный гейт и с каким набором правил?
3. `[ASK USER]` Нужна ли iOS-сборка? `app.json` содержит полный iOS-блок и `npm run ios`, а README утверждает, что iOS в форке удалён.
4. `[ASK USER]` Нужна ли поддержка V1-серверов **старше** 1.18.x (другой формат `permission.updated`)? Сейчас поддержаны два формата, более старые не проверялись.
5. `[ASK USER]` Обязателен ли V2 ≥ 2.0.24 с `/api/session/active`, или эвристику по переписке для старых V2 нужно сохранять бессрочно?
6. `[ASK USER]` Какой документ считать источником истины о текущем релизе? Статусная таблица `HANDOFF.md` приведена к 0.3.21 / 86 в этой ревизии, но исторически отставала; код и README — та же версия.
7. `[ASK USER]` Оставлять ли GitHub Pages с унаследованным сайтом апстрима (`/privacy` описывает Sentry и VIBE TECHNOLOGIES LLC) — выключить, переписать под форк или оставить как исторический?

### 7) Intent vs reality (расхождения документации и кода)

| Заявлено | Фактически | Evidence |
|----------|-----------|----------|
| `HANDOFF.md`, таблица «Состояние» | **Исправлено:** таблица приведена к 0.3.21 / 86, 833 теста (2026-11-18) | `HANDOFF.md` |
| `AGENTS.md`: «651 тест на 0.3.3» | 833 теста на 0.3.21 | `AGENTS.md`, локальный прогон |
| README: «`npm audit` — 34 записи (7 high)» | **Исправлено на 0.3.21:** `npm audit --omit=dev` — 27 записей (2 moderate, 25 high), только сборочная цепочка | `README.md`, прогон 2026-11-18 |
| README: «iOS build — no, this fork removed it» | CI/iOS-сборки нет, но iOS-блок в `app.json` и скрипт `npm run ios` остались | `app.json`, `package.json` |
| Старая карта: «заголовки уведомлений захардкожены по-английски» | **Неверно и на 0.3.3:** в `events.ts` уже тогда заголовки — `i18n.t("notifications.titles.*")`; сейчас так же локализованы и тела | `git show b0d31bc:src/stores/events.ts` (grep `title:`), `src/lib/i18n/en.json:342-359` |
| Старая карта: «401/403 на `/api/info` → V2» | **Неверно и на 0.3.3:** уже там `wantsAuth` возвращает `api: undefined` (поколение неизвестно, запись не сохраняется) | `git show b0d31bc:src/lib/api-detect.ts:63-68`, `src/lib/api-detect.ts:63-68` |
| README: «работает с opencode 1.x и 2.x» | Правда для транспортов; **живой сервер 1.18.x не проверялся** — только собственный мок-сервер | `src/lib/sdk-v1.integration.test.ts`, README §Status |
| README: «Вся» загружает весь транскрипт | Правда до 200 сообщений: курсор сообщений на проверенной сборке V2 не листает | `src/lib/sdk.ts` (`allMessages`) |
| Старая карта: «`*.test.ts` исключены из `tsconfig`, typecheck не проверяет тесты» | **Неверно и на 0.3.3:** `include` — `**/*.ts` и `**/*.tsx`, тесты проверяются `tsc --noEmit` | `tsconfig.json`, `git show b0d31bc:tsconfig.json` |
| AGENTS.md: «без `any`» | `as any`/`: any` встречаются (16 вхождений без тестов) | `ToolCallCard.tsx:358`, `stores/events.ts:642` |
| README: «таблетка, туннель и офлайн-история проверены только в коде и на эмуляторе» | Совпадает; CUA smoke на эмуляторе, реальное устройство — вручную | `.github/workflows/build.yml` (`roadmap-smoke`), README §Status |
| `.codebase-scan.txt`: «No security configs detected» | Есть gitleaks-workflow | `.github/workflows/security-scan.yml` |
| «APK не в Git» | Верно с 0.3.0 после чистки; в истории остались два APK и заметки в `dist/` из коммита `f8a2d20` (удалён из `main`, но объекты могут сохраняться на GitHub до GC; в текущем shallow-клоне проверяется `git show --stat f8a2d20`) | `.gitignore`, `git show --stat f8a2d20` |

### 8) Evidence

- `docs/codebase/.codebase-scan.txt` (TODO/FIXME, churn, top-10 largest, CI-детект)
- `git log --since="90 days ago" --name-only`
- `src/lib/sdk.ts`, `src/lib/sdk-v1.ts`, `src/lib/api-detect.ts`, `src/lib/v2-compat.ts`, `src/lib/message-page.ts`
- `src/lib/keep-alive.ts`, `src/lib/subagent-status.ts`, `src/lib/notifications.ts`
- `plugins/native/keepalive/KeepAliveService.kt`, `plugins/with-native-customizations.js`
- `src/stores/sessions.ts`, `src/stores/events.ts`, `src/stores/connections.ts`
- `app/(tabs)/index.tsx`, `app/session/[id].tsx`, `app/_layout.tsx`
- `tests/fixtures/mock-opencode-server.ts`, `src/lib/sdk-v1.integration.test.ts`
- `src/lib/offline-history.ts`, `src/lib/run-watchdog.ts`, `src/lib/stream-watchdog.ts`
- `.github/workflows/build.yml`, `.github/workflows/security-scan.yml`
- `tsconfig.json`, `package.json`, `app.json`, `README.md`, `README.ru.md`, `HANDOFF.md`, `AGENTS.md`
