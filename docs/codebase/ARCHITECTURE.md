# Архитектура

Актуально на 2026-11-07, коммит `b0d31bc` (0.3.3). Ключевое изменение против карты 0.2.28: транспорт стал **двухпротокольным** — на каждый запрос выбирается V1- или V2-клиент по сохранённому признаку соединения.

## Обязательные разделы

### 1) Архитектурный стиль

- Основной стиль: **слоистый клиент с событийным ядром и сменным транспортом**. Слои: маршруты (`app/`) → глобальные сторы (`src/stores/`) → фасад клиента (`createClient()` в `src/lib/sdk.ts`) → один из двух транспортов (`createV2Client` там же, `createV1Client` в `src/lib/sdk-v1.ts`) → сеть.
- Поверх протокола работает **адаптер V2→V1**: `src/lib/v2-compat.ts` переводит V2-пейлоады в ту форму, которую уже понимают сторы. V1-транспорт отдаёт данные сразу в этой форме, поэтому сторы и экраны о версии сервера не знают.
- Почему так: до 0.3.0 существовал единственный V2-клиент; добавление второго через флаг `config.api` не потребовало менять ни одного экрана — только фабрику `createClient()` (`src/lib/sdk.ts:876 (createClient)`), определение протокола (`src/lib/api-detect.ts:54 (detectServerApi)`) и хранение признака в подключении (`src/stores/connections.ts:103 (resolveApi)`).
- Основные ограничения, формирующие дизайн:
  1. **Версия сервера неочевидна извне.** Неизвестный маршрут на обоих поколениях отдаёт `200 text/html` из веб-интерфейса, поэтому классификация идёт по телу и `content-type`, а не по коду ответа (`src/lib/api-detect.ts:1-14`).
  2. **V2 API не имеет `message.part.updated`** — стриминг приходит дельтами уровня сессии (`session.text.delta`, `session.tool.*`), сторы работают на синтезированных V1-событиях (`src/lib/v2-compat.ts`).
  3. **V1 не имеет `/api/session/active`** и per-session переключения модели/агента: модель едет в теле промпта, «занятость» восстанавливается эвристикой по переписке (`src/lib/sdk-v1.ts:155 (createV1Client)`).
  4. **SSE волатилен**: при реконнекте пропущенные события не воспроизводятся — отсюда watchdog'и и дозагрузка переписки (`src/stores/events.ts`).
  5. **Один клиент на соединение**: клиент кэшируется по паре (база, каталог), чтобы данные не протекали между серверами (`src/lib/directory-client.ts`).

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
1. **Выбор транспорта.** `app/_layout.tsx:59` грузит настройки **до** подключений: сохранённое предпочтение `serverApi` (`auto` / `v1` / `v2`) решает, будет ли клиент построен по пробе. `resolveApi()` (`src/stores/connections.ts:103`) возвращает `auto`-режим: записанный в подключении `api`, иначе одноразовый `probeServer()` с записью результата и `serverVersion`.
2. **Вход.** `loadConnections()` строит клиент по активному соединению, затем `useEvents.connect()` открывает SSE.
3. **Запрос.** Экран вызывает действие стора; стор берёт клиент по каталогу сессии (`clientFor`) и вызывает `client.session.prompt()`.
4. **Транспорт.** Оба клиента добавляют одинаковые заголовки (`Authorization: Basic …`, `x-opencode-directory`, туннельные маркеры — `src/lib/headers.ts`). V2 разворачивает обёртки `{data}` и клампит `limit ≤ 200`; V1 читает массивы как есть.
5. **Стриминг.** V2: `V2EventAdapter.adapt()`. V1: `normalizeV1Event()` переписывает `session.idle` → `session.status`, `permission.updated` и `permission.v2.*` → `permission.asked` (`src/lib/sdk-v1.ts:130`).
6. **Состояние.** `src/stores/events.ts` маршрутизирует события: статусы, уведомления, permissions/questions; части сообщений склеиваются батчером ~40 мс.
7. **Выход.** Экран рендерит `messages`/`parts`; статистика — `computeSessionStats()` (`src/lib/session-stats.ts:21`), карточки инструментов — `tool-view.ts`.

### 3) Ответственность слоёв

| Слой / модуль | Владеет | Не должен владеть | Evidence |
|---------------|---------|-------------------|----------|
| `app/**` (маршруты) | Композиция UI, локальный стейт, навигация, вызовы сторов | Сетевые вызовы, парсинг протоколов | `app/session/[id].tsx`, `app/(tabs)/index.tsx` |
| `src/stores/events.ts` | SSE, реконнект с backoff, watchdog'и, статусы, permissions/questions, уведомления | Хранение переписки | `src/stores/events.ts` |
| `src/stores/sessions.ts` | Список и текущая сессия, сообщения/части, оптимистичные сообщения, revert, размер страницы | SSE-подключение | `src/stores/sessions.ts` |
| `src/stores/connections.ts` | Соединения, SecureStore, активный клиент, **определение и хранение версии API**, каталог сессии | UI | `src/stores/connections.ts` |
| `src/stores/settings.ts` | Настройки UI, `pageSize` (включая `ALL_TURNS`), `serverApi` | Сеть | `src/stores/settings.ts` |
| `src/stores/model-favorites.ts` | Любимые модели (AsyncStorage, глобально) | Пикеры | `src/stores/model-favorites.ts` |
| `src/lib/sdk.ts` | Фасад, V2-транспорт, `probeServer`, `createClient` | V1-детали, UI | `src/lib/sdk.ts` |
| `src/lib/sdk-v1.ts` | V1-транспорт, нормализация V1-событий и permissions | V2-детали, UI | `src/lib/sdk-v1.ts` |
| `src/lib/api-detect.ts` | Классификация сервера (v1 / v2 / не наш сервер) | Сеть (принимает `probe`) | `src/lib/api-detect.ts` |
| `src/lib/v2-compat.ts` | Преобразования V2↔V1, маппинг каталожных ответов | Сеть, RN-импорты | `src/lib/v2-compat.ts` |
| `src/lib/session-stats.ts` | Токены, процент контекста, стоимость сессии, цвет заливки | Рендер | `src/lib/session-stats.ts` |
| `src/lib/tool-view.ts` | Заголовок и тело карточки инструмента | Рендер | `src/lib/tool-view.ts` |
| `src/components/**` | Презентация и взаимодействие | Бизнес-логика, запросы | `src/components/chat/*` |
| `android/**` | Нативные инсеты IME, манифест, подпись | Логика приложения | `MainActivity.kt` |

### 4) Повторяемые паттерны

| Паттерн | Где | Зачем |
|---------|-----|-------|
| Adapter (V2→V1) | `src/lib/v2-compat.ts` | Сторы не знают о версии сервера |
| Second transport behind one facade | `createClient()` (`src/lib/sdk.ts:876`) → `createV1Client` / `createV2Client` | Добавление V1 без правок экранов |
| Probe-then-persist | `probeServer()` → `resolveApi()` → `connection.api`/`serverVersion` | Один сетевой обмен на подключение, а не на запрос; сброс при смене URL |
| Чистое решение по конверту | `detectServerApi(probe)`, `chooseHealthProbe()` | Тестируется без сети, не путает HTML-страницу с сервером |
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

- **Две реализации протокола — двойная площадь правки.** Любое новое поле сессии или события нужно провести через `v2-compat.ts` **и** `sdk-v1.ts`. Компилятор ловит расхождение в типах возврата, но не в поведении: V1 не умеет `/active`, per-session model/agent и message cursor.
- **Определение по конверту хрупко к смене веб-интерфейса.** Логика опирается на то, что неизвестный маршрут отдаёт HTML с `200`; если сервер начнёт отвечать `404`, классификация не изменится (404 не JSON и не 401/403 → проба переходит ко второму маршруту), но обратное поведение (JSON на `/api/info` у V1) сломает выбор.
- **Состояние «занятости» на V1 — эвристика.** `session.active` намеренно бросает 404 (`src/lib/sdk-v1.ts`), стор откатывается к хвосту переписки; на очень длинном прогоне без событий возможен «вечный busy».
- **Курсор сообщений сервера может не листать.** На проверенной сборке V2 `cursor.previous` отдаёт пустую страницу; обход останавливается на первой пустой странице, поэтому фактический потолок «всей сессии» — 200 сообщений (осознанно, с ограничением 10 страниц).
- **Изоляция между серверами держится на ручных сбросах.** Эпоха соединения и очистка стора выполняются подпиской на `useConnections`; любой новый стор с кэшем обязан повторить паттерн.
- **Крупные экраны**: `app/(tabs)/index.tsx` — 1546 строк, `app/session/[id].tsx` — 1412. Логика вынесена в `src/lib`, но обработчики живут в экранах.
- **Нативные правки вне JS**: клавиатура зависит от `MainActivity.installImeReporter()` и обязана совпадать с `src/lib/use-keyboard-height.ts`; рассинхронизация не ловится typecheck.

### 6) Evidence

- `src/lib/sdk.ts`, `src/lib/sdk-v1.ts`, `src/lib/api-detect.ts`, `src/lib/v2-compat.ts`, `src/lib/sse.ts`
- `src/lib/session-stats.ts`, `src/lib/tool-view.ts`, `src/lib/message-page.ts`
- `src/stores/events.ts`, `src/stores/sessions.ts`, `src/stores/connections.ts`, `src/stores/settings.ts`, `src/stores/model-favorites.ts`
- `app/_layout.tsx`, `app/session/[id].tsx`
- `src/lib/directory-client.ts`, `src/lib/part-batch.ts`, `src/lib/stream-watchdog.ts`, `src/lib/run-watchdog.ts`
- `android/app/src/main/java/cc/agentlabs/opencode/MainActivity.kt`
