# CODEX IDEAS — аудит проекта PriceVision

**Дата:** 2026-07-09

## 1. Стек и архитектура

- Next.js 15 App Router, React 19, TypeScript, Tailwind CSS.
- Supabase: Auth, RLS, Storage, service-role для серверных операций.
- AI: Gemini как основной vision/text provider, OpenRouter/OpenAI как fallback.
- Excel: `xlsx` для парсинга шаблона, `exceljs` для экспорта с сохранением форматирования.
- Основной актуальный flow:
  1. `/app/price-capture` загружает фото конкурента.
  2. `captureCompetitorPricesAction` сохраняет фото в `monitoring-photos`, вызывает `recognizeShelfPhoto`, пишет результат в `competitor_shelf_items`.
  3. `matchShelfItemsAction` берёт несопоставленные строки, строит кандидатов через `getCatalogMatchCandidates`, батчем вызывает LLM `batchMatchCatalogItems`, обновляет `catalog_product_id`.
  4. `/app/price-capture/[storeId]` показывает таблицу, ручную правку цен и экспорт.
  5. `fillTemplateWithPrices` заполняет XLSX-шаблон Яны ценами из `competitor_shelf_items`.

## 2. Что работает хорошо

- Реальный бизнес-flow выделен отдельно от старой модели `monitoring_sessions/recognized_items`.
- Распознавание и matching разделены на два этапа: можно перепрогонять matching без повторной оплаты vision.
- Батчевый LLM matching снижает стоимость и задержку относительно запроса на каждый товар.
- Экспорт перешёл на `exceljs`, поэтому форматирование шаблона сохраняется лучше, чем через `xlsx`.
- Есть базовые guards: авторизация, company membership, проверка типа/размера фото, service-role только на сервере.
- `npm run typecheck` проходит.

## 3. Проблемы и узкие места

### 🔴 Проблема: схема БД не синхронизирована с кодом

- Описание: `server/price-capture.ts` пишет `photo_filename`, а UI читает это поле. В migration `20260708160000_competitor_shelf_items.sql` колонки `photo_filename` нет.
- Где в коде: `server/price-capture.ts:143`, `app/app/price-capture/[storeId]/page.tsx:108`, `supabase/migrations/20260708160000_competitor_shelf_items.sql:24`.
- Предложение: подтвердить реальную схему prod и добавить отдельную additive migration `add column if not exists photo_filename text`.

### 🔴 Проблема: matching регрессировал, тесты падают

- Описание: `npm run test` падает в 3 сценариях: Nivea flavor, Nivea size, Persil package. Это напрямую бьёт по качеству сопоставления и экспорта.
- Где в коде: `server/catalog-matching.ts`, `tests/catalog-matching.test.mjs`.
- Предложение: сначала починить deterministic scoring до зелёных тестов, затем уже оценивать LLM слой.

### 🔴 Проблема: lint падает на export-коде

- Описание: `npm run lint` падает из-за `as any` в `server/template-export.ts`.
- Где в коде: `server/template-export.ts:246`, `server/template-export.ts:311`.
- Предложение: типизировать `exceljs` load/writeBuffer без `any` или локально сузить тип через `Buffer | ArrayBuffer` helper.

### 🔴 Проблема: preview фото вероятно строит неверный URL

- Описание: таблица использует относительный `/storage/v1/object/public/...`. В Next-приложении это не Supabase Storage URL, если нет rewrite/proxy.
- Где в коде: `app/app/price-capture/[storeId]/items-table.tsx:192`, `app/app/price-capture/[storeId]/items-table.tsx:197`.
- Предложение: генерировать public URL через Supabase client или собрать URL из `NEXT_PUBLIC_SUPABASE_URL`.

### 🟡 Проблема: документация расходится с реальным состоянием

- Описание: `HANDOFF.md` описывает старый single-step flow через `price_history` и экспорт как pending. `ROADMAP/WORKLOG` и код уже используют `competitor_shelf_items` и экспорт через `exceljs`.
- Где в коде/доках: `HANDOFF.md`, `docs/EXECUTION-ROADMAP.md`, `docs/WORKLOG.md`.
- Предложение: обновить `HANDOFF.md` как главный источник состояния или явно пометить устаревшие секции.

### 🟡 Проблема: legacy-модель остаётся в навигации

- Описание: старый `/app/monitoring` всё ещё доступен и смешан с новым `/app/price-capture`, хотя документы говорят старую модель не развивать.
- Где в коде: `app/app/page.tsx`, `app/app/monitoring/*`.
- Предложение: решить продуктово: либо скрыть legacy из основной навигации, либо явно назвать как старый режим.

### 🟡 Проблема: экспорт зависит от слабого маппинга магазина

- Описание: `resolveStoreId` мапит колонку по `name+address`, потом по уникальному `name`. Если в БД несколько одноимённых сетевых магазинов, цены не попадут в шаблон.
- Где в коде: `server/template-export.ts:77`, `server/template-export.ts:170`.
- Предложение: хранить стабильный template-column mapping при импорте или добавить ручную страницу проверки соответствий перед экспортом.

### 🟡 Проблема: долгие AI-операции идут синхронно

- Описание: загрузка нескольких фото и batch matching выполняются в request/action. На Vercel это риск таймаутов и плохой UX.
- Где в коде: `server/price-capture.ts:42`, `server/price-capture.ts:195`.
- Предложение: вынести обработку фото в job/queue, а UI показывать прогресс по `competitor_shelf_items` или `jobs`.

### 🟢 Проблема: env-схема не валидирует актуальные AI ключи

- Описание: `lib/env.ts` знает OpenAI, но не валидирует `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `AI_*`.
- Где в коде: `lib/env.ts`, `server/ai-config.ts`.
- Предложение: добавить server-only env schema для AI, не смешивая её с public env.

### 🟢 Проблема: ручная правка цены не обновляет строку локально

- Описание: цена сохраняется через API, но `ItemsTable` продолжает показывать старое значение до refresh/reload.
- Где в коде: `app/app/price-capture/[storeId]/items-table.tsx:65`.
- Предложение: хранить локальный map изменённых цен или делать `router.refresh()` после успешного save.

## 4. Идеи для улучшения

- Сделать `competitor_shelf_items` единственным источником нового monitoring flow; `price_history` и legacy monitoring не использовать в новых задачах без отдельного решения.
- Добавить E2E smoke-сценарий: upload sample photo → rows saved → match → export file generated.
- Добавить regression fixtures для matching на реальных OCR-именах: Milka, Nivea, Persil, Splat, Colgate, coffee/chocolate.
- Добавить экран контроля перед экспортом: сколько колонок магазинов сматчено, сколько товаров с ценой, сколько пустых колонок.
- Сохранять AI provider/model/usage/error на уровне фото или batch matching для диагностики качества и стоимости.
- Ввести статус строки: `recognized`, `matched`, `manual_fixed`, `excluded`, чтобы экспорт не зависел только от `catalog_product_id`.
- Перед экспортом фильтровать или подсвечивать матчи с низким `match_confidence`.

## 5. План дальнейших работ

1. Сверить prod-схему `competitor_shelf_items` и добавить missing additive migration для `photo_filename`.
2. Починить `catalog-matching.ts` до зелёного `npm run test`.
3. Убрать lint errors в `server/template-export.ts`; затем очистить warnings в новом flow.
4. Починить URL превью фото через Supabase public URL.
5. Обновить `HANDOFF.md` под текущую двухэтапную архитектуру.
6. Провести ручной E2E: фото → распознавание → matching → ручная правка цены → экспорт XLSX.
7. После стабилизации вынести AI-обработку фото в background job.

## 6. Проверки аудита

- `npm run typecheck` — ✅ чистый.
- `npm run lint` — ❌ 2 errors (`no-explicit-any` в `server/template-export.ts`) и 9 warnings.
- `npm run test` — ❌ 3 failing tests в `tests/catalog-matching.test.mjs`.
