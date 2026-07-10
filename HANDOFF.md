# PriceVision — HANDOFF для нового чата

**Дата обновления:** 2026-07-09
**Статус:** Полностью реализован двухэтапный flow + онлайн-мониторинг (TASK-21.1-21.11). Все задачи TASK-01..21.11 выполнены.

---

## ⚠️ ВАЖНО: текущая архитектура

**Реальная задача:**
1. Жена пользователя фотографирует полки конкурентов
2. Приложение распознаёт товары и цены (Этап 1)
3. Сопоставляет с каталогом (Этап 2 — отдельная кнопка)
4. Проставляет цены в шаблон Яны (Этап 3 — экспорт)
5. Пользователь скачивает готовый Excel

Две недели (1 и 2) — это два разных набора магазинов. Каталог товаров один и тот же.

**Правило Яны (критично для matching):** вкус/аромат НЕ важен. "Milka Арбуз" = "Milka Персик" для мониторинга.

---

## Текущая архитектура (двухэтапная)

### Этап 1: Загрузка фото → распознавание → `competitor_shelf_items`
- Пользователь выбирает неделю + конкурента + загружает фото
- Фото сохраняется в storage (`monitoring-photos`)
- `recognizeShelfPhoto()` распознаёт товары (Gemini/OpenRouter)
- Распознанные товары пишутся в `competitor_shelf_items` без matching

### Этап 2: Matching → `catalog_product_id`
- Пользователь нажимает «Сопоставить с каталогом» на странице магазина
- `matchShelfItemsAction` берёт несопоставленные товары из `competitor_shelf_items`
- `getCatalogMatchCandidates()` + `batchMatchCatalogItems()` (LLM) сопоставляют товары
- Результат: `catalog_product_id`, `match_confidence`, `match_reason` обновляются

### Этап 3: Экспорт в формате Яны
- Пользователь загружает шаблон Яны на `/app/price-capture/export`
- `exportMonitoringExcelAction` читает файл через exceljs
- `fillTemplateWithPrices()` подставляет цены из `competitor_shelf_items` в колонки конкурентов
- Возвращается готовый XLSX файл

---

## Что сделано (✅ готово)

### 1. Каталог в БД
- `catalog_products`: 2202 товаров, department заполнен (1265 products + 937 chemistry)
- `stores`: 116 магазинов (23 наших, 93 конкурента)
- Штрихкод = external_sku (дедуплицирован)
- Категории проставлены
- **Внимание:** поле `brand` НЕ заполнено (0/2202) — бренд только внутри названия

### 2. Таблица `competitor_shelf_items`
- Хранит распознанные товары конкурентов
- Поля: company_id, week, store_id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, price_tag_text, product_visible_text, confidence, photo_storage_path, photo_filename, captured_date, catalog_product_id, match_confidence, match_reason, matched_at
- RLS включена

### 3. Миграции (применены к прод)
- `20260708120000_monitoring_template_model.sql` — barcode/department/category в catalog_products, is_own в stores
- `20260708140000_price_history_for_template_flow.sql` — week + captured_date в price_history (устарело)
- `20260708180000_competitor_shelf_items.sql` — создана таблица competitor_shelf_items

### 4. Парсер шаблона — `server/template-parser.ts`
- Читает Excel Яны (листы Химия/Продукты)
- Понимает шапку: строка 0 = наши ТТ (merged cells), строка 1 = конкуренты
- Дедуплицирует по штрихкоду

### 5. Импорт — `server/template-import.ts` + `app/app/template-import/`
- Server action `importMonitoringTemplateAction`
- UI на `/app/template-import`

### 6. AI распознавание полок — `server/shelf-recognition/`
- Провайдер: Gemini напрямую (бесплатно), fallback на OpenRouter
- Ключи в `.env.local`: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`
- Модель: `gemini-2.5-flash-lite`

### 7. LLM matching — `server/text-ai/catalog-match-batch.ts`
- Гибридный: алгоритм `catalog-matching.ts` отбирает ~30 кандидатов → LLM выбирает точный матч
- Промпт: вкус/аромат игнорируется (правило Яны)
- Транслитерация: рус↔латиница для fuzzy-поиска

### 8. Экспорт — `server/template-export.ts`
- Читает исходный XLSX через exceljs (сохраняет форматирование)
- `fillTemplateWithPrices()` подставляет цены в колонки конкурентов
- Возвращает готовый файл

---

## Ключевые файлы (шпаргалка)

| Файл | Что делает |
|------|-----------|
| `server/price-capture.ts` | Этап 1 (распознавание → competitor_shelf_items) + Этап 2 (matching) + inline-редактирование цены |
| `server/template-parser.ts` | Парсит Excel Яны → товары/магазины/колонки |
| `server/template-import.ts` | Server action импорта каталога в БД |
| `server/template-export.ts` | Заполнение XLSX ценами конкурентов |
| `server/shelf-recognition/` | Распознавание полок (gemini/openrouter) |
| `server/shelf-recognition/normalize.ts` | Общая нормализация ответов AI |
| `server/catalog-matching.ts` | Алгоритм подбора кандидатов (с транслитерацией) |
| `server/text-ai/catalog-match.ts` | LLM выбор точного матча |
| `server/text-ai/catalog-match-batch.ts` | Батч-matching (1 запрос на всё фото) |
| `server/text-ai/json-client.ts` | Text-AI с fallback gemini→openrouter |
| `server/ai-config.ts` | Конфиг провайдеров |
| `server/ai-retry.ts` | Retry + fallback логика |
| `server/online-monitoring/alerts.ts` | Модуль алертов: правила, генерация, чтение (price_change, run_failure, out_of_stock) |
| `server/online-monitoring/normalize.ts` | Нормализация цен (price_minor), штрихкодов, размеров, транслитерация |
| `tests/online-monitoring/normalize.test.mjs` | Тесты нормализации (46 тестов) |
| `tests/online-monitoring/run-resilience.test.mjs` | Тесты идемпотентности, устойчивости к ошибкам, matching без LLM (17 тестов) |
| `tests/online-monitoring/adapter-edge-cases.test.mjs` | Тесты edge-case парсинга: пустые категории, сломанная разметка, HTTP 500 (15 тестов) |
| `app/app/online-monitoring/alerts/page.tsx` | UI список алертов + ack/resolve |
| `app/app/online-monitoring/sources/page.tsx` | UI управления источниками + store mapping (TASK-35) |
| `app/app/price-capture/page.tsx` | Страница выбора недели + конкурента |
| `app/app/price-capture/price-capture-form.tsx` | Форма загрузки фото |
| `app/app/price-capture/[storeId]/page.tsx` | Страница товаров магазина + кнопка matching |
| `app/app/price-capture/[storeId]/items-table.tsx` | Таблица товаров с inline-редактированием |
| `app/app/price-capture/[storeId]/match/route.ts` | Route для matching |
| `app/app/price-capture/export/route.ts` | Route для экспорта |
| `app/app/price-capture/export/snapshots/page.tsx` | UI истории экспортов + snapshot preview (TASK-36) |

## Структура шаблона Яны
- 2 листа: Химия, Продукты
- Строка 0: наши ТТ (merged cells)
- Строка 1: "Наша цена" + имена конкурентов
- Строки 2+: товары (штрихкод в колонке B)

## Переменные окружения (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
OPENROUTER_API_KEY
AI_VISION_PROVIDER=gemini
AI_VISION_MODEL=gemini-2.5-flash-lite
AI_TEXT_PROVIDER=gemini
AI_TEXT_MODEL=gemini-2.5-flash-lite
AI_FALLBACK_PROVIDER=openrouter
AI_FALLBACK_MODEL=google/gemini-2.5-flash-lite
```

## Статус задач TASK-01..20

| Задача | Статус |
|--------|--------|
| TASK-01 | ✅ DONE |
| TASK-02 | ✅ DONE |
| TASK-03 | ✅ DONE |
| TASK-04 | ✅ DONE |
| TASK-05 | ✅ DONE |
| TASK-06 | ✅ DONE |
| TASK-07 | ✅ DONE |
| TASK-08 | ✅ DONE |
| TASK-09 | ✅ DONE |
| TASK-10 | ✅ DONE |
| TASK-11 | ✅ DONE |
| TASK-12 | ✅ DONE |
| TASK-13 | ✅ DONE |
| TASK-14 | ✅ DONE |
| TASK-15 | ✅ DONE |
| TASK-16 | ✅ DONE |
| TASK-17 | ✅ DONE |
| TASK-18 | ✅ DONE |
| TASK-19 | ✅ DONE |
| TASK-20 | ✅ DONE |
| TASK-21.1 | ✅ DONE |
| TASK-21.2 | ✅ DONE |
| TASK-21.3 | ✅ DONE |
| TASK-21.4 | ✅ DONE |
| TASK-21.5 | ✅ DONE |
| TASK-21.6 | ✅ DONE |
| TASK-21.7 | ✅ DONE |
| TASK-21.8 | ✅ DONE |
| TASK-21.9 | ✅ DONE |
| TASK-21.10 | ✅ DONE |
| TASK-21.11 | ✅ DONE |
| TASK-31 | ✅ DONE |
| TASK-32 | ✅ DONE |
| TASK-33 | ✅ DONE |
| TASK-34 | ✅ DONE |
| TASK-35 | ✅ DONE |
| TASK-36 | ✅ DONE |
| TASK-37 | 🔜 TODO |
| TASK-38 | 🔜 TODO |
| TASK-39 | 🔜 TODO |

---

## Команды
- `npm run dev` — запуск (порт 3000)
- `npx tsc --noEmit` — typecheck
- `supabase db query --linked --file <migration.sql>` — применить миграцию

## Образцы файлов
В `_samples/`:
- `Мониторинг 1я неделя (2).xlsx`, `Мониторинг 2я неделя.xlsx` — шаблоны Яны
- `шоколадки 1.jpg`, `IMG2026...jpg` — реальные фото полок

## Соглашения проекта
- Миграции только additive
- Все цены в копейках (price_minor, bigint)
- RLS на всех таблицах через company_members.user_id
