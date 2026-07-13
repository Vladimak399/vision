# PriceVision

Интеллектуальная платформа мониторинга розничных цен по фотографиям магазинов.

**Цель:** сократить ручную работу категорийного менеджера минимум на 90%, сохраняя фото-доказательство каждой цены.

## Основные правила данных

- Excel/CSV-файл ассортимента — главный источник истины для внутренних товаров.
- Система не должна придумывать товары, цены или совпадения.
- Если уверенного совпадения с ассортиментом нет, строка должна идти на ручную проверку или получать статус “Не найдено в ассортименте”.
- Цена сохраняется только когда она прочитана с ценника и визуально привязана к товару.
- Экспорт создает новый XLSX-файл и не перезаписывает исходный файл ассортимента.

## Release 1 — Photo MVP

Импорт ассортимента, мониторинг магазина, загрузка до 500 фотографий, AI-распознавание, сопоставление, review спорных позиций, Excel и базовая история цен. Онлайн-парсинг, уведомления, PDF/CSV и расширенная аналитика запланированы после MVP.

## Стек

- Next.js 15 App Router, React 19, TypeScript.
- Supabase Postgres/Auth/Storage.
- `exceljs` для XLSX, `papaparse` для CSV.
- OpenAI/Gemini adapter для shelf recognition.
- Node test runner для unit/regression-тестов matching.

## Локальный запуск

```bash
npm install
cp .env.example .env.local
npm run dev
```

Откройте `http://localhost:3000`.

## Рабочий MVP: фото → отчет

1. Импортируйте каталог в `/app/catalog/import` или используйте уже загруженный каталог.
2. Создайте магазин и сессию в `/app/monitoring/new`.
3. Загрузите JPEG/PNG/WebP, нажмите «Распознать новые фото».
4. Откройте «Проверка товаров»: сомнительные OCR и совпадения остаются в `needs_review`.
5. Скачайте Excel или JSON из блока «Выгрузка».

Для каждой строки сохраняются исходное фото, нормализованный `bbox`, JPEG-crop ценника, OCR-текст и confidence. В отчет входят товар, цена конкурента, наша цена, разница, confidence и статус.

Для OpenRouter достаточно `OPENROUTER_API_KEY`. Рабочая цепочка OCR: бесплатный `openrouter/free` (timeout 30 секунд) → до двух попыток `qwen/qwen3-vl-30b-a3b-instruct` → быстрый rescue `openai/gpt-4.1-mini`. Переключение происходит при rate limit, timeout, перегрузке, пустом/некорректном ответе или отсутствии bbox. Модели задаются через `AI_VISION_MODEL`, `AI_FALLBACK_MODEL` и `AI_VISION_RESCUE_MODEL`.

## Переменные окружения

См. `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL` — URL Supabase project.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only key для защищенных worker/server сценариев.
- `OPENAI_API_KEY` — ключ OpenAI для OCR/vision.
- `OPENAI_OCR_MODEL` — модель OpenAI для OCR, если нужно переопределить дефолт.
- `WORKER_SIGNATURE_SECRET` — секрет подписи worker-запросов.

Не коммитьте `.env.local` и реальные ключи.

## База данных и миграции

Основной набор миграций находится в `supabase/migrations`.

Локальный/ручной flow:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Для локальной проверки с Supabase CLI обычно используется:

```bash
supabase start
supabase db reset
```

В этом изменении destructive migrations не добавлялись.

## Импорт ассортимента

Поддерживаются CSV/XLSX. Импорт читает первый лист XLSX и ожидает колонки или русские аналоги:

- `external_sku`, `sku`, `артикул`
- `name`, `название`, `наименование`
- `brand`, `бренд`
- `size_text`, `size`, `размер`
- `price`, `price_rub`, `цена`, `цена_руб`

Для реальных файлов с листами “Продукты” и “Химия” нужен следующий шаг: multi-sheet import с явным маппингом отделов.

## Excel-сценарии проверки

Минимальный smoke test:

1. Импортировать небольшой XLSX/CSV с 3–5 товарами.
2. Создать магазин и сессию мониторинга.
3. Добавить распознанные позиции или обработать фото.
4. Проверить, что слабые совпадения не auto-match-ятся.
5. Скачать `/app/monitoring/[sessionId]/export.xlsx` или detailed export.
6. Проверить листы “Сводка” и “Товары”: пустые цены остаются пустыми, unmatched помечен как “Не найдено в ассортименте”.

## Проверки проекта

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run lint` использует ESLint CLI с Next.js flat config (`eslint.config.mjs`).

## Документация

1. [Vision](docs/01-vision.md)
2. [PRD](docs/02-prd.md)
3. [Архитектура](docs/03-architecture.md)
4. [База данных](docs/04-database.md)
5. [UI/UX](docs/05-ui-ux.md)
6. [User flows](docs/06-user-flows.md)
7. [API](docs/07-api.md)
8. [AI-модуль](docs/08-ai-module.md)
9. [Распознавание изображений](docs/09-image-recognition.md)
10. [Сопоставление товаров](docs/10-product-matching.md)
11. [Онлайн-мониторинг](docs/11-online-monitoring.md)
12. [Excel-экспорт](docs/12-excel-export.md)
13. [Фото-доказательства](docs/13-evidence.md)
14. [История цен](docs/14-price-history.md)
15. [Развертывание](docs/15-deployment.md)
16. [Безопасность](docs/16-security.md)
17. [Тестирование](docs/17-testing.md)
18. [Roadmap](docs/18-roadmap.md)
19. [Backlog](docs/19-backlog.md)
20. [План релизов](docs/20-release-plan.md)
21. `PROJECT_AUDIT.md` — карта проекта и найденные риски.
22. `IMPROVEMENT_PLAN.md` — план улучшений по этапам.
23. `CHANGELOG.md` — изменения.

## Термины

- `catalog_product` — товар внутреннего ассортимента.
- `recognized_item` — позиция, извлеченная из фотографии.
- `match` — связь позиции с товаром ассортимента.
- `alias` — подтвержденное правило соответствия.
- `evidence` — фотография и координаты области, подтверждающие цену.
- `confidence` — нормализованная уверенность от `0` до `1`.

Документация написана на русском; идентификаторы, статусы и API-контракты — на английском.
