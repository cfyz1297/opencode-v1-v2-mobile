# Внешние интеграции

Актуально на 2026-11-20, версия 0.3.22 / 87. Сетевой слой в 0.3.22 не менялся: все правки — лента чата, навигатор и `scrollsChildToFocus`, поэтому реестр интеграций ниже описывает то же состояние, что и в 0.3.21. Рукопожатие SSE общее для обоих транспортов (`dialStream`), tool-часть из истории несёт собственные часы сервера, сервер может быть **двух поколений** (V1 / V2), версия определяется при подключении. С 0.3.17 к сети добавился нативный слой устройства: foreground-сервис удержания и мост уведомлений.

## Обязательные разделы

### 1) Реестр интеграций

| Система | Тип | Назначение | Модель аутентификации | Критичность | Evidence |
|---------|-----|-----------|------------------------|-------------|----------|
| `opencode serve` — V2 REST + SSE (`/api/*`) | HTTP API | Сессии, сообщения, модели, файлы, формы, каталоги, дочерние сессии | HTTP Basic `opencode:<пароль>` (пустой username/`Bearer` → 401) | высокая | `src/lib/sdk.ts` (`createV2Client`), `src/lib/headers.ts` |
| `opencode serve` — V1 REST + SSE (`/session`, `/global/*`) | HTTP API | То же для opencode 1.18.x: `/session`, `/experimental/session`, `/prompt_async`, `/global/event`, `/permission/*`, `/question/*` | тот же Basic | высокая | `src/lib/sdk-v1.ts` (`createV1Client`), `src/lib/api-detect.ts` |
| GitHub Releases API | HTTP API | Проверка обновлений: `GET releases/latest`, не чаще 1 раза в 24 ч | без авторизации | средняя | `src/lib/update-check.ts` |
| `https://www.gstatic.com/generate_204` | HTTP API | Проверка «есть ли интернет» в диагностике | нет | низкая | `src/lib/diagnostics.ts` |
| Cloudflare named tunnel / ngrok | Туннель (пользовательский) | Доступ к серверу вне LAN; адрес вводится в мастер | пароль сервера | средняя | `app/connection/tunnel.tsx`, `src/lib/tunnel.ts` |
| SecureStore (Keystore/Keychain) | Устройство | Пароли, настройки, офлайн-история, недавние каталоги | `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | высокая | `src/stores/connections.ts:22` (`SECURE_OPTIONS`), `src/lib/history-storage.ts` |
| AsyncStorage | Устройство | Скрытые **и любимые** модели, проверка обновлений | нет (не секреты) | низкая | `src/lib/model-visibility.ts`, `src/stores/model-favorites.ts`, `src/lib/update-check.ts` |
| `expo-notifications` | Локальные уведомления (iOS; Android — разрешения и канал) | Завершение, подтверждение, вопрос, ошибка, обрыв связи | разрешение ОС | средняя | `src/lib/notifications.ts` |
| Нативный мост `Notify` | Устройство (Android) | Публикация уведомления с монохромной иконкой категории и deep link `opencode://session/<id>` | — | средняя | `plugins/native/keepalive/NotifyModule.kt`, `src/lib/notifications.ts` |
| Нативный мост `KeepAlive` + `KeepAliveService` | Устройство (Android) | Foreground-сервис + headless-задача, чтобы прогон и SSE жили в фоне | `FOREGROUND_SERVICE*` в манифесте | высокая | `src/lib/keep-alive.ts`, `plugins/native/keepalive/KeepAliveService.kt`, `plugins/with-native-customizations.js:202` |
| Подпись APK (Gradle + GitHub secrets) | CI | Постоянный keystore, обновление «поверх» | `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | высокая | `.github/workflows/build.yml`, `plugins/with-native-customizations.js:16` |

Явно отсутствуют: Sentry/PostHog, БД, очереди, push-сервер, WebSocket (только SSE).

### 2) Определение версии сервера

`detectServerApi(probe)` (`src/lib/api-detect.ts:58`) делает два запроса на подключение, не на каждый запрос:

| Запрос | Ответ | Вывод |
|--------|-------|-------|
| `GET /api/info` | JSON 2xx | **V2** + `version` из тела |
| `GET /api/info` | 401 / 403 | **поколение неизвестно** (`api: undefined`): так же отвечает V1 под паролем, запись не сохраняется до успешной пробы |
| `GET /api/info` | HTML 200 | маршрута нет → проверяем V1 |
| `GET /global/health` | JSON 2xx | **V1** + `version` |
| `GET /global/health` | 401 / 403 | **V1** |
| оба | ни JSON, ни 401/403 | не сервер opencode → подключение отклоняется |

Почему не по коду ответа: на обоих поколениях неизвестный маршрут проваливается в веб-интерфейс и отвечает `200 text/html` — именно так клиент, знавший только V2, показывал «подключено» на V1-сервере. Признак пишется в подключение (`api`, `serverVersion`) и сбрасывается при смене URL (`src/stores/connections.ts` — `resolveApi`, `updateConnection`); `resolveApi` сохраняет только однозначный ответ (`resolved`). Предпочтение пользователя (`settings.serverApi`: `auto` / `v1` / `v2`) перекрывает пробу.

### 3) Каталог endpoint'ов V2 (`src/lib/sdk.ts`)

| Метод и путь | Назначение |
|--------------|-----------|
| `GET /api/info` | health/version (`healthy ?? true`) |
| `GET /api/event` | SSE-поток (`Accept-Encoding: identity`), рукопожатие ≤ 15 с через `dialStream()` (`src/lib/sse.ts`, `CONNECT_TIMEOUT_MS`) |
| `GET /api/project`, `GET /api/location` | Проекты и текущая локация |
| `GET /api/fs/list?path=` | Листинг файлов |
| `GET /file/roots` | Корни ФС; 404 → `null` |
| `GET /api/session?limit=&cursor=` | Список сессий; **транспорт идёт по `cursor.next`** (до 4 страниц по 200) |
| `GET /api/session?parentID=&limit=100` | **Дочерние сессии сабагента** (`client.session.children`); фильтрация серверная |
| `POST /api/session` | Создание (`location.directory` в теле) |
| `GET/PATCH/DELETE /api/session/{id}` | Чтение, переименование, удаление |
| `GET /api/session/{id}/message?limit=&cursor=` | Переписка; `limit ≤ 200`, newest-first; `allMessages()` листает `cursor.previous` |
| `GET /api/session/active` | Реально выполняющиеся сессии; используется и фоновым опросом (`BACKGROUND_POLL_MS = 5 с`) |
| `POST …/model`, `…/agent` | Переключение модели/агента перед промптом |
| `POST …/prompt`, `…/command` | Отправка (без клиентского таймаута) |
| `POST …/interrupt` | Прерывание |
| `POST …/compact` | Компакция |
| `GET …/diff` | Diff сессии |
| `POST …/revert/stage`, `DELETE …/revert` | Реверт и отмена |
| `GET /api/permission/request`, `POST …/permission/{id}/reply` | Разрешения |
| `GET …/form`, `…/form/{id}`, reply/delete | Вопросы модели |
| `GET /api/agent`, `/api/command`, `/api/model`, `/api/model/default`, `/api/config` | Каталоги и конфиг |
| `POST /api/integration/{id}/connect/key` → `PUT /auth/{id}` → `PUT /api/auth/{id}` | Подключение провайдера по ключу (по очереди при 404/405/501) |

### 4) Каталог endpoint'ов V1 (`src/lib/sdk-v1.ts`)

| Метод и путь | Отличие от V2 |
|--------------|---------------|
| `GET /global/health` | health/version |
| `GET /global/event` | SSE; события нормализуются (`session.idle` → `session.status`, `permission.updated`/`permission.v2.*` → `permission.asked`). С 0.3.21 использует то же ограниченное рукопожатие `dialStream()`, что и V2: раньше диал не имел срока |
| `GET /project`, `GET /project/current` | без `/api` |
| `GET /file?path=`, `GET /file/roots` | 404 → `null` |
| `GET /path` | home/state/config/worktree/directory |
| `GET /experimental/session?limit=&cursor=` | глобальный список; **листается по заголовку `x-next-cursor`** (до 10 страниц), дедуп по id, повторный/битый курсор завершает обход |
| `GET /session` | fallback, если `/experimental/session` → 404 (постранично не листается) |
| `GET/POST/PATCH/DELETE /session/{id}` | CRUD |
| `GET /session/{id}/message?limit=` | переписка целиком, без курсора. По умолчанию сервер отдаёт 50 сообщений, поэтому обновление экрана всегда передаёт `limit` из `pageSize` |
| `GET /session/{id}/message` (limit 200) | `allMessages()` — весь транскрипт |
| `POST /session/{id}/prompt_async` | модель/агент **в теле**, отдельных `/model` и `/agent` нет |
| `POST /session/{id}/command`, `/abort`, `/summarize` | команды, прерывание, компакция |
| `GET /session/{id}/diff`, `/revert`, `/unrevert` | diff и реверт |
| `GET /permission`, `POST /permission/{id}/reply` | без sessionID в пути |
| `GET /question`, `POST /question/{id}/reply\|reject` | фильтрация по `sessionID` на клиенте |
| `GET /agent`, `/command`, `/provider`, `/config` | каталоги |
| `PUT /auth/{id}` | ключ провайдера (`{type:"api", key}`) |
| `GET /api/session/active` | **отсутствует**: метод намеренно бросает 404 → стор использует эвристику по переписке |
| `client.session.children` | **отсутствует**: список дочерних сессий не запрашивается (исключение ловит `loadChildren`), карточки сабагентов строятся только из tool-частей |

### 5) Уведомления и фон

| Механизм | Что делает | Evidence |
|----------|------------|----------|
| Категории | `permissions`, `questions`, `completed`, `errors`, `connection`; дефолты: включены все, кроме `completed` | `src/lib/notifications.ts:10-50` |
| Канал Android | `CHANNEL_ID = "prompts"`; отдельный скрытый канал удержания (`IMPORTANCE_NONE`) | `src/lib/notifications.ts:95`, `KeepAliveService.kt` |
| Публикация | Android — нативный `Notify.notify(category, title, body, sessionId, channelId)`; iOS — `expo-notifications` | `src/lib/notifications.ts:256`, `NotifyModule.kt` |
| Тап | deep link `opencode://session/<id>`; разбор в `app/_layout.tsx` (`notifications.onTap`) | `NotifyModule.kt`, `app/_layout.tsx:79` |
| Отложенные | Пока приложение на экране (`AppState === "active"`), уведомление откладывается (не больше 5, `HOLD_TTL_MS = 3 с`); при уходе в фон публикуются отложенные не старше 3 с, при возврате — выбрасываются как уже видимые | `src/lib/notifications.ts:181-243`, `app/_layout.tsx:114-124` |
| Дедуп | `dedupeKey` + кулдаун по умолчанию 30 с, с очисткой старых записей (BUG-029) | `src/lib/notifications.ts:205-211` |
| Фоновый опрос | Раз в 5 с `GET /api/session/active`; сравнение с прошлым тиком, чтобы не терять завершения и не дублировать их | `src/stores/events.ts:404-490` |
| Удержание процесса | `setKeepAlive(true)` при старте прогона; сервис + headless-задача; `START_NOT_STICKY`; тип `dataSync\|specialUse` | `src/lib/keep-alive.ts:74`, `plugins/native/keepalive/KeepAliveService.kt` |

### 6) Хранилища данных

| Хранилище | Роль | Ключевой риск | Evidence |
|-----------|------|---------------|----------|
| SecureStore: `opencode_connections` | JSON-список соединений (без паролей), с `api`/`serverVersion` | Раздувание/повреждение JSON — терпимый парсер | `src/stores/connections.ts:18` |
| SecureStore: `opencode_recent_dirs` | До 10 недавних каталогов | Только пути, не секреты | `src/stores/connections.ts:23,24` |
| SecureStore: `opencode_password_<id>` | Пароль сервера | Утечка при политике по умолчанию — закрыто `SECURE_OPTIONS` | `src/stores/connections.ts:22,191` |
| SecureStore: `opencode_settings` | Настройки UI, `pageSize` (включая `ALL_TURNS`), `serverApi`, категории уведомлений | Повреждённый JSON → дефолты; новые категории доливаются при чтении (`mergeStoredSettings`) | `src/stores/settings.ts:11`, `src/lib/settings-merge.ts` |
| SecureStore: `opencode_auth_settings` | Биометрия | — | `src/stores/auth.ts` |
| SecureStore: `opencode_history_enabled` + `opencode_history_<id>` и чанки | Согласие и офлайн-история, только текст, read-only | Объём (лимиты 120k символов, 320 чанков, 40 сообщений) | `src/lib/offline-history.ts:12`, `src/lib/history-storage.ts` |
| AsyncStorage: `opencode_model_visibility_v1` | Скрытые модели | Локально для устройства | `src/lib/model-visibility.ts:3` |
| AsyncStorage: `opencode_model_favorites_v1` | Любимые модели (глобально, без привязки к серверу) | Только id провайдера/модели; тот же валидатор, что у скрытых | `src/lib/model-visibility.ts:6`, `src/stores/model-favorites.ts` |
| AsyncStorage: ключи проверки обновлений | Отметка о проверке/скрытой версии | — | `src/lib/update-check.ts`, `src/lib/update-check-policy.ts` |

### 7) Секреты и учётные данные

- Источники: пользовательский ввод (пароль сервера, API-ключ провайдера), GitHub Actions secrets, локальный `android/app/release.keystore` (в `.gitignore`).
- Хардкод-проверка: паролей/токенов в коде нет; вшиты только публичные URL и SHA-256 сертификата релиза. Gitleaks-скан в CI — `.github/workflows/security-scan.yml`.
- API-ключи провайдеров клиент не сохраняет: отправляются на сервер и забываются (`src/lib/provider-auth.ts`; на V1 — `PUT /auth/{id}`).
- Транспорт: `usesCleartextTraffic=true` (вносится плагином) и `NSAllowsArbitraryLoads` — осознанно для LAN/Termux; предупреждение о пароле по `http://` показывается, но не блокирует (`src/lib/connection-security.ts`).

### 8) Надёжность и поведение при сбоях

- Таймауты: общий запрос 30 с (`REQUEST_TIMEOUT_MS`, `src/lib/http.ts:7`); тест соединения 12 с; health-probe 5 с; диагностические пробы 8 с; **проба определения API 8 с** (`PROBE_TIMEOUT_MS`); **рукопожатие SSE 15 с** (`CONNECT_TIMEOUT_MS` в `src/lib/sse.ts`, общее для V1 и V2 через `dialStream()`); `prompt`/`command`/`prompt_async` — без клиентского таймаута.
- **Часы инструмента в истории.** Сервер отправляет на tool-части `time: {created, ran, completed}`; `toolTime()` (`src/lib/v2-compat.ts`) переносит их в `state.time` как `{start: ran ?? created, end: completed}`. Без этого переоткрытая сессия не знала длительностей инструментов.
- Повторы: SSE-реконнект с backoff `[1,2,4,8,15]` ±25 % и стабилизацией 10 с; при 401/403 цикл останавливается и выставляется `authError`. Повторов HTTP-запросов, кроме цепочки provider connect, нет.
- Восстановление: watchdog сокета 30 с, watchdog прогона 12 с с одной дозагрузкой на «тихое окно», сверка с `/api/session/active` после реконнекта и в фоне (только V2/V1-эвристика соответственно).
- Fallback'и: `/file/roots` 404 → `null`; `/api/model/default` ошибка → `null`; провал обновления каталога не стирает уже показанный каталог (`src/stores/catalog.ts`); отсутствующий `healthy` → `true` на уровне SDK, но `probeConnection` требует строго `true`; провал пробы API → прежнее поведение (V2), чтобы сохранённое подключение не переставало открываться.
- **Туннели:** `Bypass-Tunnel-Reminder` и `ngrok-skip-browser-warning` в каждом запросе (`src/lib/headers.ts`), иначе ngrok отдаёт HTML-заглушку и приложение сообщает о неверном пароле.

### 9) Наблюдаемость интеграций

- Логи только по ошибкам/переходам: `[SSE]`, `[Events]`, `[sendMessage]`; успешные HTTP-вызовы не логируются. Исходы уведомлений (`posted`/`held`/`disabled`/`no-permission`/`deduped`/`failed`) попадают в лог-буфер.
- Диагностика: классификация пробы, отчёт с `Server API: v1|v2`, редактирование хоста/URL (`src/lib/scrub.ts`), копирование/шаринг. Health-проба требует JSON или 401/403, поэтому HTML-страница не считается живым сервером.
- Метрики/трейсинг отсутствуют; телеметрия удалена, диагностика уходит только в системный share sheet по нажатию пользователя.

### 10) Evidence

- `src/lib/sdk.ts`, `src/lib/sdk-v1.ts`, `src/lib/api-detect.ts`, `src/lib/v2-compat.ts`, `src/lib/headers.ts`
- `src/lib/auth.ts`, `src/lib/provider-auth.ts`, `src/lib/connection-health.ts`, `src/lib/connection-security.ts`
- `src/lib/notifications.ts`, `src/lib/notify-format.ts`, `src/lib/keep-alive.ts`
- `plugins/native/keepalive/KeepAliveService.kt`, `plugins/native/keepalive/NotifyModule.kt`, `plugins/with-native-customizations.js`
- `src/lib/update-check.ts`, `src/lib/diagnostics.ts`, `src/lib/scrub.ts`
- `src/stores/connections.ts`, `src/stores/events.ts`, `src/stores/settings.ts`, `src/stores/catalog.ts`, `src/lib/settings-merge.ts`
- `src/lib/offline-history.ts`, `src/lib/history-storage.ts`, `src/lib/model-visibility.ts`
- `.github/workflows/build.yml`, `.github/workflows/security-scan.yml`, `app.json`, `android/app/src/main/AndroidManifest.xml`
