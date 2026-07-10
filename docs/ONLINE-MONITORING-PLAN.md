# Online-мониторинг — план реализации

## 1. Цель

Сделать автоматический сбор цен конкурентов из онлайн-каталогов и использовать эти цены в том же бизнес-flow, что и ручные фото полок: сопоставление с `catalog_products`, просмотр в UI, экспорт в шаблон мониторинга.

Ручной flow не заменяем. Онлайн-мониторинг становится вторым источником цен рядом с фото:

- `photo`: текущий `competitor_shelf_items`.
- `online`: новые наблюдения из сайтов конкурентов.

Первый production-scope: только конкуренты из БД (`stores.is_own = false` + `competitors`), у которых есть проверенный онлайн-каталог и разрешенная модель доступа.

Начальный список источников:

- SPAR Калининград: `spar-online.ru/catalog/`, потому что есть публичный каталог с категориями и количеством товаров.
- METRO Калининград: `online.metro-cc.ru` + `metro-cc.ru/markets/kaliningrad/ul-moskovskii-pr-t-d-279`, потому что есть онлайн-каталог и конкретный торговый центр в Калининграде.
- Магнит: `magnit.ru/catalog`, после отдельной проверки региона/магазина и условий использования.
- Пятёрочка/X5: `5ka.ru`, после отдельной проверки каталога, выбранного магазина, региона и условий использования.

Источник включается не по названию в коде, а через инвентаризацию БД и таблицу настроек источников. Если в БД есть `Спар`, `SPAR`, `Метро`, `METRO`, `Магнит`, `Пятёрочка`, `5ka`, `X5`, адаптер предлагает привязку. Оператор подтверждает ее в UI.

## 2. Архитектура

### 2.1. Главный принцип

Не расширять `competitor_shelf_items` под онлайн-данные.

Причина: таблица описывает результат OCR с фото: `week`, `photo_storage_path`, `photo_filename`, `price_tag_text`, `confidence` распознавания, ручное редактирование. Онлайн-источник имеет другой lifecycle: source run, external product id, URL, availability, raw payload, parser version, rate limit, повторные наблюдения.

Нужна отдельная модель `online_*` и общий слой чтения цен для UI/экспорта.

### 2.2. Компоненты

```text
Vercel Cron / manual run
  -> app/api/cron/online-monitoring/route.ts
  -> creates online_source_runs / jobs
  -> external Node worker
  -> source adapter: SPAR / METRO / Magnit / X5
  -> normalize products/prices
  -> online_source_products
  -> online_prices
  -> online_product_matches via current catalog-matching + LLM batch
  -> UI + export through unified price observation reader
```

### 2.3. Где запускать парсинг

Рекомендуемый production-вариант: отдельный Node worker с Playwright/fetch и Supabase service-role.

Vercel Cron подходит как легкий scheduler: он дергает HTTP endpoint по расписанию и создает run/job, но не должен сам обходить весь каталог. По текущей документации Vercel Cron вызывает Vercel Function HTTP GET по `vercel.json`, а Node/Python Functions на Pro/Enterprise могут работать до 30 минут с `maxDuration`, но браузерный парсинг все равно лучше выносить в worker из-за Chromium, retries, rate limits и изоляции от пользовательских запросов.

Supabase Edge Functions + pg_cron подходят для легких HTTP задач, но не для Playwright. Их можно использовать только как альтернативный scheduler, если не нужен headless browser.

Итог:

- MVP: Vercel Cron создает `online_source_runs`, worker запускается отдельно по расписанию или постоянно.
- Допустимый dev/manual mode: admin-кнопка создает один run для одного source/store.
- Не делать: парсинг внутри пользовательского request/response, Edge Runtime для браузера, обход captcha/anti-bot.

### 2.4. Схема данных

Новые таблицы, отдельной миграцией после подтверждения:

`online_sources`

- `id`
- `company_id`
- `competitor_id`
- `source_key`: `spar_online`, `metro_online`, `magnit`, `x5_5ka`
- `display_name`
- `base_url`
- `enabled`
- `parser_version`
- `legal_status`: `pending`, `allowed`, `blocked`
- `rate_limit_per_minute`
- `config jsonb`
- `created_at`, `updated_at`

`online_source_stores`

- `id`
- `company_id`
- `source_id`
- `store_id`
- `source_store_id`
- `source_city`
- `source_address`
- `source_region`
- `price_context`: `online_delivery`, `store_visit`, `catalog_promo`
- `enabled`
- `config jsonb`
- `last_seen_at`

`online_source_runs`

- `id`
- `company_id`
- `source_id`
- `source_store_id`
- `trigger`: `cron`, `manual`, `retry`
- `status`: `queued`, `running`, `succeeded`, `failed`, `cancelled`
- `started_at`, `completed_at`
- `parser_version`
- `stats jsonb`
- `error_summary`

`online_source_run_events`

- `id`
- `company_id`
- `run_id`
- `level`: `info`, `warn`, `error`
- `message`
- `metadata jsonb`
- `created_at`

`online_source_products`

- `id`
- `company_id`
- `source_id`
- `source_product_id`
- `url`
- `raw_name`
- `normalized_name`
- `brand`
- `size_text`
- `barcode`
- `category_path`
- `image_url`
- `metadata jsonb`
- `first_seen_at`, `last_seen_at`
- unique: `(company_id, source_id, source_product_id)`

`online_product_matches`

- `id`
- `company_id`
- `source_product_id`
- `catalog_product_id`
- `confidence`
- `method`: `barcode`, `fuzzy`, `llm`, `manual`
- `status`: `auto`, `needs_review`, `confirmed`, `rejected`
- `reason`
- `matched_at`, `reviewed_at`, `reviewed_by`

`online_prices`

- `id`
- `company_id`
- `run_id`
- `source_id`
- `source_store_id`
- `store_id`
- `source_product_id`
- `catalog_product_id`
- `price_minor`
- `old_price_minor`
- `promo_price_minor`
- `currency`
- `availability`: `in_stock`, `out_of_stock`, `unknown`
- `observed_at`
- `source_url`
- `raw_payload_hash`
- `created_at`

Индексы:

- `online_prices(company_id, store_id, catalog_product_id, observed_at desc)`
- `online_prices(company_id, source_store_id, source_product_id, observed_at desc)`
- `online_product_matches(company_id, source_product_id) where status in ('auto', 'confirmed')`
- `online_source_runs(company_id, status, started_at desc)`

RLS: та же модель, что у `competitor_shelf_items`: доступ через `company_members.user_id`. Worker пишет через service-role, пользовательские страницы читают через RLS.

Для PriceVision `online_source_stores` обязателен. Нельзя сохранять цену сети без привязки к Калининграду: минимум `source_city = 'kaliningrad'`, лучше `source_store_id` + `source_address`. Для METRO дополнительно фиксируем `price_context`, потому что на странице торгового центра могут быть отдельно онлайн-цены и цены при посещении ТЦ.

### 2.5. Flow сбора

1. Scheduler выбирает enabled `online_source_stores`.
2. Создает `online_source_runs` со статусом `queued`.
3. Worker берет run через атомарный claim: `queued -> running`.
4. Adapter получает каталог:
   - сначала обычный HTTP/fetch и HTML/JSON parsing;
   - Playwright только если каталог зависит от JS, cookies региона или выбора магазина;
   - без авторизации, captcha bypass, агрессивного параллелизма.
5. Adapter возвращает единый контракт:
   - `sourceProductId`
   - `url`
   - `title`
   - `brand`
   - `sizeText`
   - `barcode`
   - `priceMinor`
   - `oldPriceMinor`
   - `promoPriceMinor`
   - `availability`
   - `observedAt`
   - `rawPayloadHash`
6. `online_source_products` upsert по `(source_id, source_product_id)`.
7. Новые или непроверенные товары проходят matching:
   - barcode/external_sku match, если есть;
   - `getCatalogMatchCandidates()` из `server/catalog-matching.ts`;
   - `batchMatchCatalogItems()` для LLM выбора;
   - результат пишется в `online_product_matches`.
8. `online_prices` получает price observation. Если match найден, заполняется `catalog_product_id`.
9. Run закрывается со stats: fetched, products_upserted, prices_inserted, matched, unmatched, errors.
10. UI и экспорт читают последние цены через новый серверный модуль `server/price-observations.ts`.

### 2.6. Adapter interface

```ts
export type OnlineSourceAdapter = {
  key: "spar_online" | "metro_online" | "magnit" | "x5_5ka";
  parserVersion: string;
  fetchCatalog(input: FetchCatalogInput): AsyncIterable<OnlineProductObservation>;
};
```

Глубокий module: вызывающий код знает только `fetchCatalog()`. Внутри адаптера остаются cookies региона, pagination, HTML/API parsing, retries и source-specific normalization.

### 2.7. Обновление цен

Расписание:

- Daily price refresh: каждый день 06:00 Europe/Kaliningrad.
- Weekly discovery: 1 раз в неделю полный обход категорий и поиск новых товаров.
- Manual run: кнопка для одного source/store.

Для MVP не нужно обходить весь интернет-магазин каждый час. Цель мониторинга - стабильная дневная точка сравнения.

### 2.8. Калининград и store mapping

Все онлайн-цены ищутся только в контексте Калининграда.

Правила:

- не использовать федеральную/общесетевую цену без `online_source_stores`;
- для каждого конкурента хранить точную привязку: `stores.id -> online_source_stores.source_store_id/source_address/source_city`;
- если сайт дает только город, но не магазин, хранить `source_city = 'kaliningrad'` и `source_store_id = null`, а в UI показывать источник как городскую онлайн-цену;
- если сайт разделяет online delivery и цену в торговом центре, хранить это в `price_context`;
- export берет только цены, где `source_city/source_region` соответствует Калининграду или явно привязанному магазину.

### 2.9. UI

Новая страница: `app/app/online-monitoring/`.

Экраны:

- Dashboard источников: source, store mapping, last run, status, last success, errors.
- Latest prices: товар, конкурент, цена, промо, availability, источник, observed_at, match status.
- Unmatched review: online product -> кандидаты каталога -> confirm/reject.
- Runs: история запусков, stats, ошибки.

Текущий `app/app/price-capture/` не перегружать. Можно добавить ссылку из рабочей области и на странице магазина показать отдельный блок "Онлайн-цены" позже.

Экспорт:

- Вынести чтение цен из `server/template-export.ts` в `server/price-observations.ts`.
- `fillTemplateWithPrices()` должен получать latest price по `(catalog_product_id, store_id, week)`.
- При конфликте источников:
  - default: брать самое свежее наблюдение;
  - если нужны фото как доказательство: режим `photo_only`;
  - для онлайн-мониторинга: режим `online_preferred`.

### 2.10. Уведомления

Опционально после MVP:

- `online_price_alert_rules`
- `online_price_alerts`

События:

- конкурент стал дешевле нашей цены на N%;
- цена изменилась больше чем на N%;
- товар пропал из наличия;
- source run падает 2 раза подряд.

Канал MVP: UI badge + список alerts. Email/Telegram позже.

### 2.11. Внешние ограничения

Перед включением source в production нужно проверить:

- условия использования сайта;
- robots.txt;
- есть ли официальный API/partner feed;
- нужна ли авторизация;
- можно ли хранить raw HTML/JSON;
- как выбирается город/магазин;
- rate limits и допустимая частота.

Ссылки для текущего решения:

- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Vercel Function duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel 30-minute Functions changelog](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [SPAR Online catalog](https://spar-online.ru/catalog/)
- [METRO online catalog](https://online.metro-cc.ru/category)
- [METRO Калининград, Московский пр-т, д. 279](https://metro-cc.ru/markets/kaliningrad/ul-moskovskii-pr-t-d-279)
- [5ka.ru](https://5ka.ru/)
- [magnit.ru/catalog](https://magnit.ru/catalog)

## 3. Список задач

### TASK-21.1 - Source inventory и legal audit

Приоритет: P0.

Файлы:

- `docs/ONLINE-SOURCE-RESEARCH.md`
- `server/online-monitoring/source-detection.ts`

Сделать:

- собрать из БД список `competitors` + `stores` для текущей компании;
- нормализовать названия конкурентов;
- предложить source candidates: SPAR, METRO, Magnit, X5/5ka;
- проверить terms/robots/API/регион;
- запретить production scrape, пока `legal_status != allowed`.

### TASK-21.2 - DB schema для online-source

Приоритет: P0.

Файлы:

- `supabase/migrations/<timestamp>_online_monitoring.sql`
- `docs/04-database.md`

Сделать:

- добавить `online_sources`, `online_source_stores`, `online_source_runs`, `online_source_run_events`;
- добавить `online_source_products`, `online_product_matches`, `online_prices`;
- добавить индексы и RLS;
- не менять `competitor_shelf_items`;
- не менять production БД без отдельного подтверждения.

### TASK-21.3 - Core module и adapter contract

Приоритет: P0.

Файлы:

- `server/online-monitoring/types.ts`
- `server/online-monitoring/registry.ts`
- `server/online-monitoring/normalize.ts`
- `server/online-monitoring/run.ts`

Сделать:

- единый `OnlineSourceAdapter`;
- нормализация цены в копейки;
- общий retry/backoff;
- run stats и error collection;
- fixture-friendly parsing.

### TASK-21.4 - SPAR adapter

Приоритет: P0.

Файлы:

- `server/online-monitoring/adapters/spar-online.ts`
- `tests/online-monitoring/spar-online.test.mjs`
- `tests/fixtures/online/spar-online/*.html`

Сделать:

- начать с `spar-online.ru/catalog/`;
- распарсить категории, pagination, карточки товара;
- сохранить `source_product_id`, URL, название, цену, наличие;
- не использовать Playwright, если хватает HTML/fetch.

### TASK-21.5 - Worker и scheduler

Приоритет: P1.

Файлы:

- `app/api/cron/online-monitoring/route.ts`
- `server/worker/online-monitoring-worker.ts`
- `server/online-monitoring/claim-run.ts`
- `package.json`
- `vercel.json` только после отдельного подтверждения

Сделать:

- cron endpoint только создает queued runs;
- worker claim-ит run и выполняет adapter;
- защитить cron endpoint секретом;
- добавить `npm run worker:online`;
- не запускать Playwright в пользовательских routes.

### TASK-21.6 - Matching online products

Приоритет: P1.

Файлы:

- `server/online-monitoring/matching.ts`
- `server/catalog-matching.ts`
- `server/text-ai/catalog-match-batch.ts`

Сделать:

- barcode/external_sku match первым;
- затем `getCatalogMatchCandidates()`;
- затем LLM batch;
- сохранять `online_product_matches`;
- повторно не тратить LLM для уже confirmed/auto matches.

### TASK-21.7 - Unified price reader и экспорт

Приоритет: P1.

Файлы:

- `server/price-observations.ts`
- `server/template-export.ts`
- `tests/template-export-online-prices.test.mjs`

Сделать:

- единый read model для latest photo/online prices;
- режимы `photo_only`, `online_only`, `online_preferred`, `latest`;
- обновить `fillTemplateWithPrices()` без изменения формата Excel.

### TASK-21.8 - UI online monitoring

Приоритет: P1.

Файлы:

- `app/app/online-monitoring/page.tsx`
- `app/app/online-monitoring/runs/page.tsx`
- `app/app/online-monitoring/unmatched/page.tsx`
- `app/app/online-monitoring/actions.ts`
- `app/app/page.tsx`

Сделать:

- показать status источников;
- показать latest prices;
- показать unmatched queue;
- добавить ручной запуск одного source/store;
- добавить ссылку из рабочей области.

### TASK-21.9 - METRO, Magnit и X5 adapters

Приоритет: P2.

Файлы:

- `server/online-monitoring/adapters/magnit.ts`
- `server/online-monitoring/adapters/metro-online.ts`
- `server/online-monitoring/adapters/x5-5ka.ts`
- `tests/online-monitoring/magnit.test.mjs`
- `tests/online-monitoring/metro-online.test.mjs`
- `tests/online-monitoring/x5-5ka.test.mjs`

Сделать:

- сначала research и fixtures;
- определить store/region context;
- для METRO явно различить `online_delivery` и `store_visit`;
- предпочитать публичный web catalog/API;
- Playwright только при необходимости;
- включать source disabled-by-default.

### TASK-21.10 - Alerts

Приоритет: P2.

Файлы:

- `server/online-monitoring/alerts.ts`
- `app/app/online-monitoring/alerts/page.tsx`
- `supabase/migrations/<timestamp>_online_price_alerts.sql`

Сделать:

- правила изменения цены;
- alerts по падению source runs;
- UI список alerts;
- email/Telegram оставить отдельной задачей.

### TASK-21.11 - Parser tests и quality gates

Приоритет: P1.

Файлы:

- `tests/online-monitoring/*.test.mjs`
- `tests/fixtures/online/**`

Сделать:

- fixture tests на HTML/JSON;
- тест идемпотентности run;
- тест, что ошибка одной страницы не валит весь run;
- тест matching без LLM для confirmed match;
- `npm run typecheck`, `npm run lint`, `npm run test`.

## 4. Риски

### Юридический риск

Сайты могут запрещать scraping или ограничивать автоматический доступ. Нельзя включать источник без research, rate limit, kill switch и `legal_status = allowed`.

### Антибот и нестабильная разметка

Каталоги могут менять HTML/API, требовать cookies региона, блокировать headless browser. Нужны fixtures, parser versions, run logs и быстрый disable source.

### Неправильный магазин/регион

Онлайн-цены зависят от города и точки доставки. Нельзя считать цену сети универсальной. Нужна явная привязка `stores.id -> online_source_stores.source_store_id`.

### Ошибочный matching

Онлайн-названия короче или отличаются от каталога. Автоматический match должен иметь confidence/status и review queue. Barcode match приоритетнее LLM.

### Смешивание источников

Фото и online нельзя хранить в одной таблице без source lifecycle. Экспорт должен явно выбирать стратегию источников.

### Service role

Worker может использовать service-role, но пользовательские pages/actions не должны обходить RLS. Cron endpoint должен быть подписан секретом.

### Multi-company context

Текущий проект использует primary company без явного switcher. Для online runs нельзя запускать job при неоднозначной компании. Перед multi-company production нужен явный current-company selector.

### Стоимость и время

Полный daily crawl больших сетей может быть дорогим и долгим. Начать с SPAR и ограниченного набора категорий/товаров, затем расширять.
