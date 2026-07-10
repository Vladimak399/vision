# FUTURE PLAN — дальнейшее развитие PriceVision

## 1. Текущее состояние

PriceVision уже закрывает основной бизнес-flow:

- импорт шаблона Яны и каталога в БД;
- загрузка фото полок конкурентов;
- OCR/Vision через Gemini с fallback на OpenRouter;
- запись распознанных товаров в `competitor_shelf_items`;
- отдельный matching с каталогом через deterministic candidates + LLM batch;
- inline-правка цен;
- экспорт XLSX в формате Яны через `exceljs`;
- онлайн-мониторинг как отдельный источник цен: `online_*` таблицы, adapters для SPAR/METRO/Magnit/X5, worker, UI, alerts-модуль;
- единый reader цен `server/price-observations.ts` для фото/online/export.

Метрики на 2026-07-09:

- `catalog_products`: 2202 товара.
- `stores`: 116 магазинов, из них 23 свои и 93 конкурента.
- `brand` в `catalog_products`: 0/2202 заполнено, бренд сейчас извлекается из названия.
- `npm run typecheck`: ✅ проходит.
- `npm run test`: ✅ 135/135 тестов проходят.
- `npm run lint`: ❌ 8 errors, 53 warnings.

Что ещё не готово для production:

- online migrations нужно отдельно проверить: в SQL есть риск синтаксических ошибок и они не должны применяться без подтверждения;
- ручной запуск online-source в UI сейчас расходится с action contract (`sourceId` vs `sourceKey`);
- `unmatched` UI для online-matching выглядит неполным: нет выбора кандидата каталога, confirm отправляет пустой `catalogProductId`;
- генерация alerts реализована как модуль, но не встроена в worker после run/price insert;
- `online_preferred` fallback на фото работает глобально, а не по каждой паре `(catalog_product_id, store_id)`;
- cron/worker production-запуск не доведён до runbook/deploy-конфигурации;
- online sources должны оставаться disabled/pending до legal/rate-limit проверки;
- browser E2E и живой production smoke для online-flow не зафиксированы.

## 2. Что можно улучшить (по приоритету)

### 🔴 P0 — стабилизация перед новым функционалом

- Исправить lint errors в online-модулях и убрать `.tmp` из lint surface.
- Провести migration-safety audit для `online_monitoring.sql` и `online_price_alerts.sql`; подготовить исправления, не применяя БД без подтверждения.
- Починить manual run online-monitoring: единый контракт формы/action, корректный `source_id`/`source_store_id`.
- Доделать online unmatched review: join с `online_source_products`, поиск/выбор `catalog_products`, запись `confirmed/rejected`.
- Исправить `online_preferred` fallback: online-цена приоритетна, фото fallback должен работать по отсутствующей паре товар+магазин.
- Встроить `generateRunAlerts` и price/out-of-stock alerts в worker lifecycle.

### 🟡 P1 — качество данных и UX оператора

- Добавить preflight-экран перед экспортом: покрытие магазинов, товаров, пустых колонок, low-confidence matches.
- Усилить store mapping: стабильная привязка колонок шаблона к `stores.id`, а не только `name/address`.
- Добавить run detail page: события run, ошибки adapter, stats, parser version.
- Добавить E2E smoke: sample photo → save rows → match → edit price → export XLSX.
- Добавить browser smoke для `/app/online-monitoring`, `/runs`, `/unmatched`, `/alerts`.
- Добавить AI telemetry: provider/model/error/cost/duration для OCR и matching.
- Вынести долгие фото/LLM операции из request/action в job queue с прогрессом.

### 🟢 P2 — расширение и аналитика

- Настройки источников в UI: legal_status, enabled, rate limit, store mapping, parser config.
- Email/Telegram notifications для alerts.
- История цен и графики по товару/конкуренту.
- Автоматическое извлечение brand/category из каталога.
- Quality dashboard: match rate, OCR confidence, unmatched count, parser failures.
- Snapshot-экспорт: фиксировать набор цен, из которого был создан XLSX.

## 3. Новые фичи

- **Source management UI**: управлять online sources без правки БД вручную.
- **Review queue 2.0**: быстрый поиск товара каталога, подтверждение aliases, массовое принятие confident matches.
- **Export preflight**: до скачивания показывать, какие цены попадут в файл и где есть пропуски.
- **Price history analytics**: динамика цен по конкурентам, промо, out-of-stock.
- **Notification channels**: Telegram/email для критичных алертов.
- **Run replay/debug**: повторить failed run с тем же config и сохранить parser diagnostics.
- **AI diagnostics dashboard**: стоимость, latency, fallback rate, ошибки JSON/normalization.
- **Catalog enrichment**: brand extraction, normalized product family, alias learning из ручных подтверждений.

## 4. Технический долг

- Lint не зелёный: `any`, unused imports/vars, `.tmp` debug files.
- Online migrations требуют SQL-проверки и явной стратегии применения/rollback.
- В коде много inline-style UI; стоит вынести повторяемые таблицы/status badges/nav в минимальные компоненты.
- Supabase row-типы сейчас часто приводятся вручную; нужен typed boundary для ключевых таблиц.
- Legacy `/app/monitoring` остаётся рядом с новым `/app/price-capture`; нужно явно решить: скрыть, архивировать или поддерживать.
- `server/template-export.ts` содержит устаревшие helpers после перехода на `price-observations`.
- Store mapping для Excel слабый при одноимённых магазинах.
- `price-observations` смешивает правила выбора источника и загрузку данных; нужна точная стратегия fallback и тесты на mixed coverage.
- Alerts generation не подключена к worker, поэтому UI может быть пустым даже при сбоях.
- Worker работает sequential и без production runbook: нет deployment инструкции, healthcheck, graceful shutdown, lock timeout.
- Нет DB integration tests для RLS/миграций/реального Supabase schema drift.

## 5. План на следующий спринт

### TASK-22 — Lint baseline и `.tmp` cleanup

- Убрать 8 lint errors.
- Исключить `.tmp` из lint или удалить debug-файлы после подтверждения.
- Оставить warnings отдельным списком.
- Проверки: `npm run lint`, `npm run typecheck`, `npm run test`.

### TASK-23 — Online migration safety audit

- Проверить `20260709120000_online_monitoring.sql` и `20260709150000_online_price_alerts.sql`.
- Исправить SQL syntax/idempotency в новой additive migration или патче.
- Не применять production БД без отдельного подтверждения.
- Проверки: локальная SQL-валидация, dry-run/ручной review.

### TASK-24 — Manual run online-monitoring

- Починить форму `/app/online-monitoring`: передавать корректный source/store contract.
- Создавать `online_source_runs` с валидным `source_id` и `source_store_id`.
- Добавить тест или server-action smoke.

### TASK-25 — Unmatched review для online products

- Читать данные через join `online_product_matches -> online_source_products`.
- Показывать кандидатов каталога и поиск.
- Confirm должен сохранять реальный `catalog_product_id`.
- Reject должен исключать товар из export.

### TASK-26 — Price observation fallback

- Исправить `online_preferred`: online first, photo fallback по каждой паре товар+магазин.
- Добавить тест на mixed coverage: часть цен online, часть только photo.
- Проверить `latest` и `online_only`.

### TASK-27 — Alerts lifecycle integration

- Вызывать run-failure alerts после failed run.
- Вызывать price-change/out-of-stock alerts после вставки новых `online_prices`.
- Добавить минимальные fixture/unit tests.

### TASK-28 — Export preflight MVP

- Перед экспортом показать coverage: matched stores, filled prices, missing columns, low-confidence rows.
- Не менять формат XLSX.
- Цель: пользователь видит риск до скачивания файла.

### TASK-29 — E2E smoke сценарии

- Фото-flow: upload sample → rows → match → edit → export.
- Online-flow: create run → worker process → prices → export mode.
- Зафиксировать ручные шаги и автоматизируемую часть в `tests/` или docs.

### TASK-30 — Worker production runbook

- Описать запуск `npm run worker:online`, env, healthcheck, retry policy, stop/start.
- Описать cron scheduling без изменения `vercel.json` до подтверждения.
- Добавить checklist для включения source: legal_status, rate limit, store mapping.
