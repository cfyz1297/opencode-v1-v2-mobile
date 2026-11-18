# Архитектура

Актуально на 2026-11-18, версия 0.3.21 / 86. Транспорт по-прежнему **двухпротокольный**; слои живучести (foreground-сервис + headless-задача, 0.3.17) и сабагентов (0.3.20) на месте, а в 0.3.21 появился слой **логического транскрипта**: `transcript-rows` склеивает шаги ассистента в одну строку ленты, `part-runs` — работу между ответами в один спойлер, `message-navigation` считает позицию по раскладке для навигатора.

## Обязательные разделы

### 1) Архитектурный стиль

- Основной стиль: **слоистый клиент с событийным ядром и сменным транспортом**. Слои: маршруты (`app/`) → глобальные сторы (`src/stores/`) → фасад клиента (`createClient()` в `src/lib/sdk.ts:852`) → один из двух транспортов (`createV2Client` там же, `createV1Client` в `src/lib/sdk-v1.ts:90`) → сеть.
- Поверх протокола работает **адаптер V2→V1**: `src/lib/v2-compat.ts` переводит V2-пейлоады в ту форму, которую уже понимают сторы. V1-транспорт отдаёт данные сразу в этой форме, поэтому сторы и экраны о версии сервера не знают.
- Рядом с сетевым слоем живут два «внепротокольных» механизма:
  1. **Фоновое удержание**: `src/lib/keep-alive.ts` дергает нативный мост `KeepAlive` (foreground-сервис + headless-задача, `plugins/native/keepalive/`), пока есть активный прогон, иначе Android замораживает процесс и рвёт SSE.
  2. **Фоновый опрос**: `startBackgroundWatch()` (`src/stores/events.ts:473`) раз в 5 с (`BACKGROUND_POLL_MS`) спрашивает `/api/session/active`, потому что в фоне сокет и JS-таймеры ненадёжны.
- Почему так: добавление второго транспорта не потребовало менять ни одного экрана — только фабрику `createClient()`, определение протокола (`src/lib/api-detect.ts:58 (detectServerApi)`) и хранение признака в подключении (`src/stores/connections.ts:94 (resolveApi)`).
- Основные ограничения, формирующие дизайн:
  1. **Версия сервера неочевидна извне.** Неизвестный маршрут на обоих поколениях отдаёт `200 text/html` из веб-интерфейса, поэтому классификация идёт по телу и `content-type`, а не по коду ответа (`src/lib/api-detect.ts:1-16`). Отдельно: **401/403 на `/api/info` больше не считается признаком V2** — так отвечает и V1-сервер под паролем, поэтому поколение остаётся неизвестным до успешной пробы (`api-detect.ts:63-68`).
  2. **V2 API не имеет `message.part.updated`** — стриминг приходит дельтами уровня сессии (`session.text.delta`, `session.tool.*`), сторы работают на синтезированных V1-событиях (`src/lib/v2-compat.ts`).
  3. **V1 не имеет `/api/session/active`**, `session.children` и per-session переключения модели/агента: модель едет в теле промпта, «занятость» восстанавливается эвристикой по переписке (`src/lib/sdk-v1.ts`, `active` бросает 404).
  4. **SSE волатилен**: при реконнекте пропущенные события не воспроизводятся — отсюда watchdog'и, дозагрузка переписки и фоновый опрос (`src/stores/events.ts`).
  5. **Один клиент на соединение**: клиент кэшируется по паре (база, каталог), чтобы данные не протекали между серверами (`src/lib/directory-client.ts`).
  6. **`android/` — вывод prebuild.** Нативные правки живут в `plugins/with-native-customizations.js` и применяются на каждом прогоне; ручная правка `android/**` теряется.

### 2) Поток системы

```text
Экран (app/*) → стор (src/stores/*) → client.session.prompt() (фасад sdk.ts)
   ├─ V2: createV2Client  → HTTP /api/*, SSE /api/event
   └─ V1: createV1Client  → HTTP /session/*, SSE /global/event
      → Basic auth + x-opencode-directory → opencode serve
   ← SSE → SSEParser (src/lib/sse.ts) → V2EventAdapter (v2-compat) | normalizeV1Event (sdk-v1)
   → V1-события → events.ts → sessions.ts (part-batcher) → ререндер экрана
```

Пошагово:
1. **Выбор транспорта.** `app/_layout.tsx` грузит настройки **до** подключений: сохранённое предпочтение `serverApi` (`auto` / `v1` / `v2`) решает, будет ли клиент построен по пробе. `resolveApi()` возвращает записанный `api`, иначе делает `probeServer()`; неоднозначный ответ не сохраняется (`resolved: false`), а сохранённое ранее подключение продолжает открываться по прежнему поведению (V2).
2. **Вход.** `loadConnections()` строит клиент по активному соединению, затем `useEvents.connect()` открывает SSE.
3. **Запрос.** Экран вызывает действие стора; стор берёт клиент по каталогу сессии (`clientFor`) и вызывает `client.session.prompt()`.
4. **Транспорт.** Оба клиента добавляют одинаковые заголовки (`Authorization: Basic …`, `x-opencode-directory`, туннельные маркеры — `src/lib/headers.ts`). V2 разворачивает обёртки `{data}` и клампит `limit ≤ 200`; V1 читает массивы как есть. Рукопожатие SSE ограничено 15 с (`CONNECT_TIMEOUT_MS`, `src/lib/sdk.ts:236`), иначе «Connected» показывался над мёртвым сокетом.
5. **Стриминг.** V2: `V2EventAdapter.adapt()` (`src/lib/v2-compat.ts:629`). V1: `normalizeV1Event()` переписывает `session.idle` → `session.status`, `permission.updated` и `permission.v2.*` → `permission.asked` (`src/lib/sdk-v1.ts:65`).
6. **Состояние.** `src/stores/events.ts` маршрутизирует события: статусы (`sessionStatus`), ошибки (`sessionErrors`), уведомления, permissions/questions; части сообщений склеиваются батчером ~40 мс. `session.created` с `parentID` уходит в `childrenByParent`, а не в общий список сессий.
7. **Фон.** При уходе в background `setKeepAlive(true)` поднимает сервис, `flushHeld()` публикует отложенные алерты (не старше 3 с), `startBackgroundWatch()` опрашивает `/api/session/active` раз в 5 с и сравнивает с прошлым тиком; возврат в foreground останавливает опрос, выбрасывает отложенные (`dropHeld`), перечитывает каталог и при долгом отсутствии вызывает `resumeFromBackground()`.
8. **Выход.** Экран строит строки ленты через `buildTranscriptRows()` (`src/lib/transcript-rows.ts`): подряд идущие сообщения ассистента — одна строка, её части читаются в порядке модели и режутся на отрезки `groupParts()` (`src/lib/part-runs.ts`). Текст рисуется напрямую, отрезок — `ActivitySpoiler` со сводкой `summarizeToolActivity()` (`src/lib/tool-summary.ts`), делегирование сабагента — отдельной карточкой. Статистика — `computeSessionStats()` (`src/lib/session-stats.ts:21`), карточки инструментов — `tool-view.ts` + `tool-duration.ts`, сабагенты — `collectSubagents()` (`src/lib/subagent-status.ts`) и `SubagentBar`.
9. **Навигатор.** Компактная панель над композером двигается по сообщениям пользователя: `MessageNavigation` (`src/lib/message-navigation.ts`) хранит кадры ячеек (`CellRendererComponent` даёт координаты в контенте), `userRowIds()` — цели, `scrollToIndex` — переход.

### 3) Ответственность слоёв

| Слой / модуль | Владеет | Не должен владеть | Evidence |
|---------------|---------|-------------------|----------|
| `app/**` (маршруты) | Композиция UI, локальный стейт, навигация, вызовы сторов | Сетевые вызовы, парсинг протоколов | `app/session/[id].tsx`, `app/(tabs)/index.tsx` |
| `src/stores/events.ts` | SSE, реконнект с backoff, watchdog'и, фоновый опрос, статусы, ошибки сессий, permissions/questions, уведомления | Хранение переписки | `src/stores/events.ts` |
| `src/stores/sessions.ts` | Список и текущая сессия, сообщения/части, оптимистичные сообщения, revert, дочерние сессии (`childrenByParent`) | SSE-подключение | `src/stores/sessions.ts` |
| `src/stores/connections.ts` | Соединения, SecureStore, активный клиент, **определение и хранение версии API**, недавние каталоги | UI | `src/stores/connections.ts` |
| `src/stores/settings.ts` | Настройки UI, `pageSize` (включая `ALL_TURNS`), `serverApi`, категории уведомлений | Сеть | `src/stores/settings.ts` |
| `src/lib/keep-alive.ts` | Мост к foreground-сервису и headless-задаче, счётчик активной работы | Логика уведомлений | `src/lib/keep-alive.ts` |
| `src/lib/notifications.ts` | Категории, разрешения, канал, отложенные/дедуплицированные отправки, нативный мост `Notify` | Выбор момента (решает `events.ts`) | `src/lib/notifications.ts` |
| `src/lib/subagent-status.ts` | Статус дочерней сессии, волны, порядок и счётчики | Отрисовка | `src/lib/subagent-status.ts` |
| `src/lib/transcript-rows.ts` | Склейка шагов ассистента в строку ленты, цели навигатора (сообщения пользователя) | Отрисовка, сеть | `src/lib/transcript-rows.ts` |
| `src/lib/part-runs.ts` | Отрезки между ответами: рассуждения + инструменты в один блок; делегирование выносится отдельно | Отрисовка | `src/lib/part-runs.ts` |
| `src/lib/message-navigation.ts` | Позиция в ленте по разложенным кадрам, шаг на одно сообщение, владение позицией после прыжка | Сеть, отрисовка | `src/lib/message-navigation.ts` |
| `src/lib/tool-summary.ts` | Имена и сумма времени инструментов для свёрнутой строки | Рендер | `src/lib/tool-summary.ts` |
| `src/lib/sdk.ts` | Фасад, V2-транспорт, `probeServer`, `createClient` | V1-детали, UI | `src/lib/sdk.ts` |
| `src/lib/sdk-v1.ts` | V1-транспорт, нормализация V1-событий и permissions | V2-детали, UI | `src/lib/sdk-v1.ts` |
| `src/lib/api-detect.ts` | Классификация сервера (v1 / v2 / неизвестно) | Сеть (принимает `probe`) | `src/lib/api-detect.ts` |
| `src/lib/v2-compat.ts` | Преобразования V2↔V1, маппинг каталожных ответов, синтез `time` инструментов | Сеть, RN-импорты | `src/lib/v2-compat.ts` |
| `src/lib/session-stats.ts` | Токены, процент контекста, стоимость сессии, цвет заливки | Рендер | `src/lib/session-stats.ts` |
| `src/components/**` | Презентация и взаимодействие | Бизнес-логика, запросы | `src/components/chat/*` |
| `plugins/**` | Нативные правки (подпись, IME, cleartext, keep-alive, иконки) и Kotlin-исходники сервиса | JS-логика | `plugins/with-native-customizations.js`, `plugins/native/keepalive/` |

### 4) Повторяемые паттерны

| Паттерн | Где | Зачем |
|---------|-----|-------|
| Adapter (V2→V1) | `src/lib/v2-compat.ts` | Сторы не знают о версии сервера |
| Second transport behind one facade | `createClient()` (`src/lib/sdk.ts:852`) → `createV1Client` / `createV2Client` | Добавление V1 без правок экранов |
| Probe-then-persist | `probeServer()` → `resolveApi()` → `connection.api`/`serverVersion` | Один сетевой обмен на подключение, а не на запрос; неоднозначный ответ не пишется |
| Чистое решение по конверту | `detectServerApi(probe)` | Тестируется без сети, не путает HTML-страницу с сервером |
| Foreground service + headless task | `src/lib/keep-alive.ts` → `KeepAliveService` | Сервис держит процесс, задача держит `hasActiveTasks()` — без неё RN останавливает `setInterval` |
| Скрытый канал FGS | `KeepAliveService.hideKeepAliveChannel` | Android обязан показывать карточку сервису; канал `IMPORTANCE_NONE` убирает её, не снимая foreground-статус |
| Нативный мост вместо библиотеки | `NotifyModule` (`plugins/native/keepalive/NotifyModule.kt`) | expo-notifications умеет только одну small icon — монохромную иконку на категорию даёт только своя реализация |
| Опрос серверной правды в фоне | `pollWhileBackgrounded()` (`src/stores/events.ts:437`) | В фоне сокет и таймеры ненадёжны; `/api/session/active` — источник истины |
| Группировка по волнам | `collectSubagents()` (`src/lib/subagent-status.ts`) | Новый промпт = новая партия сабагентов; «текущая» кнопка показывает последнюю волну + всё ещё работающих |
| Логическая строка ленты | `buildTranscriptRows()` (`src/lib/transcript-rows.ts`) | Один ответ = одна шапка, один «Скопировать», одна сводка токенов |
| Спойлер на отрезок | `groupParts()` (`src/lib/part-runs.ts`) + `ActivitySpoiler` | Долгий прогон не выталкивает ответ с экрана; делегирование остаётся снаружи |
| Позиция по раскладке, не по событию | `MessageNavigation.observe()` + `CellRendererComponent` | `onViewableItemsChanged` на инвертированном списке не срабатывает до первого скролла — позиция была неизвестна |
| Общее рукопожатие SSE | `dialStream()` (`src/lib/sse.ts`) + `CONNECT_TIMEOUT_MS` | Ни один транспорт не висит вечно после «подключено» |
| Дочерние сессии отдельно от списка | `childrenByParent` (`src/stores/sessions.ts:71`) | Сабагент не должен появляться в Recent и не должен исчезать из карточки |
| Singleton-сторы (zustand) | `src/stores/*.ts` | Глобальное состояние без DI-контейнера |
| Кэш клиентов (WeakMap) | `src/lib/directory-client.ts` | Отдельный клиент на каталог |
| «Эпоха соединения» + seq-guard | `connectionEpoch`, `selectSeq`, `loadOlderSeq` (`src/stores/sessions.ts`) | Поздний ответ не перезаписывает новый выбор |
| Watchdog (2 уровня) | `stream-watchdog.ts` (30 с), `run-watchdog.ts` (12 с) | Локальное восстановление «Работаю…» |
| Возврат из фона | `stream-watchdog.ts` (15 с) → `resumeFromBackground()` | Пересоздать поток после Doze и перечитать сессию |
| Батчинг дельт | `src/lib/part-batch.ts` | Один рендер на ~40 мс |
| Защита от отката текста | `src/lib/part-order.ts` | Старая дельта не затирает готовый ответ |
| Сохранение загруженной истории | `keepLoadedHistory()` (`src/lib/message-page.ts:53`) | Обновление экрана не выкидывает старые сообщения |
| Fail-closed | `api-error.ts`, `connection-health.ts`, `api-detect.ts` | Любой не-2xx/не-JSON = ошибка, а не успех |
| Внедрение зависимостей в чистые модули | `createHistory(storage)`, `createTunnelConnector`, `detectServerApi(probe)`, `parseStoredJSON(raw, fallback, label)` | Тестируемость под `node --test` |

### 5) Известные архитектурные риски

- **Две реализации протокола — двойная площадь правки.** Любое новое поле сессии или события нужно провести через `v2-compat.ts` **и** `sdk-v1.ts`. Компилятор ловит расхождение в типах, но не в поведении: V1 не умеет `/active`, `children`, per-session model/agent и message cursor.
- **Сабагенты на V1 недоделаны по данным, а не по UI.** Карточки и счётчики строятся из `metadata.sessionID` tool-части, но `client.session.children()` есть только у V2 (`src/lib/sdk.ts:482`); `loadChildren` глотает исключение (`src/stores/sessions.ts:197`), поэтому на V1 дочерние сессии не подгружаются. Нести ли `metadata.sessionID` сервер 1.18.x — [TODO].
- **Определение по конверту хрупко к смене веб-интерфейса.** Логика опирается на то, что неизвестный маршрут отдаёт HTML с `200`; если сервер начнёт отвечать `404`, классификация не изменится, но JSON на `/api/info` у V1 сломает выбор. Неоднозначный 401/403 теперь честно оставляет поколение неизвестным — соединение открывается по прежнему поведению (V2), пока проба не удастся.
- **Состояние «занятости» на V1 — эвристика.** `session.active` намеренно бросает 404, стор откатывается к хвосту переписки; на очень длинном прогоне без событий возможен «вечный busy».
- **Фоновое удержание зависит от политики Android.** `dataSync` ограничен 6 ч за 24 на Android 15, поэтому тип сервиса — `dataSync|specialUse` с `onTimeout`-остановкой; при отзыве разрешения или убийстве процесса уведомления замолкают (`plugins/native/keepalive/KeepAliveService.kt`).
- **Курсор сообщений сервера может не листать.** На проверенной сборке V2 `cursor.previous` отдаёт пустую страницу; обход останавливается на первой пустой странице, поэтому фактический потолок «всей сессии» — 200 сообщений (осознанно, с ограничением 10 страниц).
- **Изоляция между серверами держится на ручных сбросах.** Эпоха соединения и очистка стора выполняются подпиской на `useConnections`; любой новый стор с кэшем обязан повторить паттерн.
- **Крупные экраны**: `app/(tabs)/index.tsx` — 1546 строк, `app/session/[id].tsx` — 1922. Логика вынесена в `src/lib` (`transcript-rows`, `part-runs`, `message-navigation`, `tool-summary`), но обработчики по-прежнему живут в экранах.
- **Навигатор зависит от раскладки ячеек.** Позиция считается по кадрам, которые приходят только для смонтированных строк; если строка ещё не разложена, `visible()` берёт ближайшую измеренную, а неизвестная позиция трактуется как самое новое сообщение. Это осознанный компромисс: `onViewableItemsChanged` не срабатывает до первого скролла, а `onLayout` на самой строке даёт `y = 0` относительно ячейки.
- **Нативные правки вне JS**: клавиатура зависит от `installImeReporter()` (вносится плагином) и обязана совпадать с `src/lib/use-keyboard-height.ts`; рассинхронизация не ловится typecheck. С SDK 58 то же самое касается `usesCleartextTraffic`: без него приложение не достучится до `http://127.0.0.1`.

### 6) Evidence

- `src/lib/sdk.ts`, `src/lib/sdk-v1.ts`, `src/lib/api-detect.ts`, `src/lib/v2-compat.ts`, `src/lib/sse.ts`
- `src/lib/session-stats.ts`, `src/lib/tool-view.ts`, `src/lib/tool-duration.ts`, `src/lib/tool-summary.ts`, `src/lib/message-page.ts`
- `src/lib/transcript-rows.ts`, `src/lib/part-runs.ts`, `src/lib/message-navigation.ts`, `src/lib/nav-panel.ts`, `src/lib/markdown-keys.ts`, `src/lib/disconnect-reason.ts`
- `src/components/chat/ActivitySpoiler.tsx`, `src/components/markdown/MarkdownImage.tsx`
- `src/lib/keep-alive.ts`, `plugins/native/keepalive/KeepAliveService.kt`, `plugins/native/keepalive/NotifyModule.kt`
- `src/lib/notifications.ts`, `src/lib/subagent-status.ts`
- `src/stores/events.ts`, `src/stores/sessions.ts`, `src/stores/connections.ts`, `src/stores/settings.ts`
- `app/_layout.tsx`, `app/session/[id].tsx`
- `src/lib/directory-client.ts`, `src/lib/part-batch.ts`, `src/lib/stream-watchdog.ts`, `src/lib/run-watchdog.ts`
- `plugins/with-native-customizations.js`
