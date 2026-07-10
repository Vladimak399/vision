# CODEX FINAL AUDIT — финальная проверка

Дата: 2026-07-09

## 1. Выполнено (TASK-01..30)

TASK-01..20 закрыли основной фото-flow PriceVision:

- импорт шаблона Яны и каталога;
- загрузка фото полок конкурентов;
- OCR/Vision через Gemini с fallback на OpenRouter;
- запись распознанных строк в `competitor_shelf_items`;
- отдельный matching с каталогом через deterministic candidates + LLM batch;
- inline-правка цены;
- экспорт XLSX в формате Яны через `exceljs`;
- миграция `photo_filename`;
- корректный Supabase Storage URL для фото;
- актуализированный `HANDOFF.md`.

TASK-21.1..21.11 закрыли MVP онлайн-мониторинга:

- source inventory и legal-gate модель;
- online tables/migrations: `online_sources`, `online_source_stores`, `online_source_runs`, `online_source_products`, `online_product_matches`, `online_prices`, `online_price_alerts`;
- adapter contract, registry, normalization, run context;
- адаптеры SPAR, METRO, Magnit, X5/5ka;
- cron producer и worker consumer;
- online matching;
- единый price reader `server/price-observations.ts`;
- UI `/app/online-monitoring`, `/runs`, `/unmatched`, `/alerts`;
- alerts module;
- fixture/parser tests и smoke tests.

TASK-22..30 из `docs/FUTURE-PLAN.md` выполнены в MVP-объёме:

- TASK-22: lint baseline очищен до 0 errors.
- TASK-23: online migration safety audit проведён документально/локально; production DB не трогалась.
- TASK-24: manual run online-monitoring приведён к корректному source/store contract.
- TASK-25: online unmatched review получил join, кандидатов и confirm/reject flow.
- TASK-26: `online_preferred` fallback исправлен по паре `(catalog_product_id, store_id)`.
- TASK-27: alerts подключены к lifecycle worker-а.
- TASK-28: export preflight MVP добавлен перед XLSX-выгрузкой.
- TASK-29: E2E smoke сценарии добавлены.
- TASK-30: worker production runbook написан, блокеры B1-B6 зафиксированы.

Текущие метрики:

- `npm run typecheck` — OK, 0 errors.
- `npm run lint` — OK, 0 errors, 52 warnings.
- `npm run test` — OK, 141/141 tests passed.
- Документированные данные проекта: `catalog_products` — 2202, `stores` — 116, `brand` в `catalog_products` — 0/2202 заполнено.

## 2. Осталось (блокеры и долги)

🔴 B1. Worker всё ещё импортирует `claimRun`, `getRun` из `server/online-monitoring/run.ts`, где используется `createSupabaseServerClient()` и `cookies()` из `next/headers`. Автономный `npm run worker:online` упадёт вне HTTP-контекста. Нужно перевести worker на service-role версии `claimRun/getRun`.

🔴 B2. В `vercel.json` нет `crons`, поэтому `/api/cron/online-monitoring` не вызывается автоматически. Нужен Vercel Cron или внешний scheduler.

🔴 B3. `/api/cron/online-monitoring` требует `CRON_SECRET`; наличие production env в этом аудите не проверялось, `.env*` не читались. Без секрета endpoint вернёт `401`.

🔴 B6. У worker нет graceful shutdown и lock timeout. Прерванный run может остаться `running` навсегда и не вернуться в очередь.

🟡 B5. RPC `claim_online_source_run` отсутствует в migrations. Есть fallback через conditional update, поэтому это не hard-fail, но атомарность лучше закрепить на уровне БД.

🟡 Production DB/RLS не проверены живым прогоном. Локальные тесты не покрывают drift схемы, RLS и реальные Supabase policies.

🟡 Online adapters протестированы на fixtures, но live scrape/legal/rate-limit не подтверждены. Sources должны оставаться disabled/pending до явного legal/rate-limit решения.

🟡 Слабый store mapping в XLSX export: `resolveStoreId` опирается на `name/address`, нет стабильной привязки template column → `stores.id`.

🟡 Legacy `/app/monitoring` всё ещё есть в навигации рядом с новым `/app/price-capture`. Нужен продуктовый выбор: скрыть, архивировать или поддерживать.

🟡 Долгие AI/photo/matching операции всё ещё идут синхронно в request/action. На Vercel остаётся риск timeout и плохого UX.

🟡 Inline-правка цены сохраняет значение через API, но локальная строка таблицы не обновляется до refresh/reload.

🟡 AI telemetry отсутствует: нет системного учёта provider/model/cost/duration/fallback/error по OCR и matching.

🟢 B4. `WORKER_SIGNATURE_SECRET` есть в env schema/README, но не участвует в worker/monitoring flow. Это документационный/config cleanup.

🟢 Остались lint warnings: unused imports/vars, `<img>` warning, старые helper-функции в `template-export.ts`.

## 3. План на следующий спринт

### TASK-31 — Fix worker service-role boundary

- Перенести `getRun` в service-role модуль или создать `getRunForWorker`.
- В `server/worker/online-monitoring-worker.ts` импортировать `claimRun/getRun` из service-role boundary.
- Убрать неиспользуемый `createRun` import.
- Добавить smoke/unit test, который гарантирует, что worker не вызывает `createSupabaseServerClient()`.

### TASK-32 — Worker lifecycle safety

- Добавить `SIGTERM`/`SIGINT` handling.
- Добавить requeue/fail policy для stale `running` runs.
- Добавить lock timeout или DB-side recovery.
- Зафиксировать безопасный retry без дублей `online_prices`.

### TASK-33 — Scheduler production setup

- После подтверждения prod-конфига добавить Vercel `crons` или внешний scheduler.
- Проверить `CRON_SECRET` в deployment env.
- Добавить smoke для `401` без токена и успешного queued-run creation с токеном.

### TASK-34 — Production DB/RLS verification

- Провести dry-run/review online migrations.
- Проверить RLS policies для online tables.
- Добавить RPC `claim_online_source_run` или явно зафиксировать fallback как выбранное решение.
- Добавить seed/настройку alert rules.

### TASK-35 — Online source management UI

- Управление `enabled`, `legal_status`, rate limit, parser config.
- Store mapping для `online_source_stores`.
- Явный checklist перед включением source.

### TASK-36 — Export mapping hardening

- Стабильная привязка колонок шаблона к `stores.id`.
- Экран проверки mapping перед экспортом.
- Snapshot export: фиксировать набор цен, из которого создан XLSX.

### TASK-37 — Async AI jobs и telemetry

- Вынести photo OCR и LLM matching из request/action в job queue.
- Добавить прогресс по job/run.
- Логировать provider/model/duration/fallback/error/cost.

### TASK-38 — Legacy monitoring decision

- Скрыть `/app/monitoring` из основной навигации или явно пометить как legacy.
- Зафиксировать, какие старые routes поддерживаются.
- Обновить docs после решения.

### TASK-39 — Full production smoke

- Фото-flow: upload → recognition → matching → edit price → preflight → export.
- Online-flow: cron/manual run → worker → prices → alerts → export mode.
- Browser smoke для `/app/online-monitoring`, `/runs`, `/unmatched`, `/alerts`.

## 4. Риски

- Worker сейчас не готов к production run из-за B1.
- Cron может быть настроен в коде, но без scheduler/env не создаст runs.
- Live сайты конкурентов могут поменять HTML/API, заблокировать scraping или нарушить rate limits.
- Без graceful shutdown stale `running` runs потребуют ручного SQL recovery.
- Ошибка store mapping может silently оставить цены вне XLSX.
- Локальные tests зелёные, но не доказывают production Supabase schema/RLS correctness.
- AI latency/fallback/cost не наблюдаемы, поэтому деградации будут видны поздно.
