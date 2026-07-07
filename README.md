# PriceVision

Интеллектуальная платформа мониторинга розничных цен по фотографиям магазинов.

**Цель:** сократить ручную работу категорийного менеджера минимум на 90%, сохраняя фото-доказательство каждой цены.

## Основные правила данных

- Excel/CSV-файл ассортимента — главный источник истины для внутренних товаров.
- Система не должна придумывать товары, цены или совпадения.
- Если уверенного совпадения с ассортиментом нет, строка должна идти на ручную проверку или получать статус “Не найдено в ассортименте”.
- Цена сохраняется только когда она прочитана с ценника и визуально привязана к товару.
- Экспорт создает новый XLSX-файл и не перезаписывает исходный файл ассортимента.

## Стек

- Next.js 15 App Router, React 19, TypeScript.
- Supabase Postgres/Auth/Storage.
- `xlsx` для XLSX, `papaparse` для CSV.
- OpenAI/Gemini adapter для shelf recognition.
- Node test runner + `tsx` для unit-тестов.

## Локальный запуск

```bash
npm install
cp .env.example .env.local
npm run dev
```

Откройте `http://localhost:3000`.

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

Поддерживаются CSV/XLS/XLSX. Импорт читает первый лист XLS/XLSX и ожидает колонки или русские аналоги:

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
npm run build
```

`npm run lint` использует ESLint CLI с Next.js flat config (`eslint.config.mjs`).

## Документация

- `PROJECT_AUDIT.md` — карта проекта и найденные риски.
- `IMPROVEMENT_PLAN.md` — план улучшений по этапам.
- `CHANGELOG.md` — изменения.
- `docs/` — продуктовая и техническая документация.
