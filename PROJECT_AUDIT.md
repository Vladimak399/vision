# PROJECT_AUDIT.md

## Краткое резюме
PriceVision — Next.js-приложение для мониторинга розничных цен по фотографиям полок. Главный бизнес-поток: импорт ассортимента из CSV/XLSX, создание сессии мониторинга, загрузка фото, OCR/AI-распознавание товаров и цен, сопоставление с внутренним каталогом, ручная проверка спорных строк и экспорт результата в Excel.

## Стек технологий
- Frontend/backend: Next.js 15 App Router, React 19, TypeScript strict mode.
- UI: Tailwind CSS, lucide-react.
- Backend actions/routes: Server Actions и Route Handlers внутри `app/`.
- База и storage: Supabase PostgreSQL, RLS, Supabase Storage.
- Excel/CSV: `xlsx` для XLSX и `papaparse` для CSV.
- AI/OCR: OpenAI и Gemini-адаптеры, конфигурация через env.
- Валидация env: `zod`.
- Тесты после изменений: Node test runner + `tsx`.

## Структура папок
- `app/` — Next.js маршруты, страницы, server actions и Excel export routes.
- `app/app/catalog/` — импорт и просмотр ассортимента.
- `app/app/monitoring/` — сессии мониторинга, загрузка фото, review, export.
- `server/` — доменная backend-логика: auth, catalog, matching, AI OCR, membership/access.
- `server/shelf-recognition/` — AI/OCR prompt, OpenAI/Gemini клиенты, типы результата.
- `lib/` — Supabase clients и env parsing.
- `supabase/migrations/` — основные миграции Supabase.
- `db/` — legacy/local SQL bootstrap и seed.
- `docs/` — продуктовая и техническая документация.
- `tests/` — unit-тесты бизнес-логики, добавлены в рамках этого изменения.

## Как запускается проект
1. `npm install`
2. Создать `.env.local` по `.env.example`.
3. Поднять/подключить Supabase и применить миграции из `supabase/migrations`.
4. `npm run dev` для локальной разработки.
5. Проверки: `npm run typecheck`, `npm test`, `npm run build`.

## Где фронтенд
Фронтенд находится в `app/**/*.tsx`. Основные рабочие экраны:
- `/login` — вход.
- `/app` — рабочая зона.
- `/app/catalog` и `/app/catalog/import` — каталог и импорт.
- `/app/monitoring` — список сессий.
- `/app/monitoring/[sessionId]` — сессия, загрузка фото, запуск обработки.
- `/app/monitoring/[sessionId]/review` — ручная проверка найденных позиций.

## Где бэкенд
Бэкенд реализован в Next.js Server Actions/Route Handlers и `server/`:
- `app/app/**/actions.ts` — мутации UI.
- `app/app/monitoring/[sessionId]/**/*.ts` — действия с фото, review, matching и export.
- `server/*.ts` — общая бизнес-логика и доступ к Supabase.

## Работа с Excel
- Импорт ассортимента: `app/app/catalog/actions.ts`, функция `parseImportFile` читает первый лист XLS/XLSX и CSV.
- Экспорт мониторинга: `app/app/monitoring/[sessionId]/export.xlsx/route.ts` и `export-detailed.xlsx/route.ts` создают новые XLSX-файлы.
- Текущий проект не редактирует исходный Excel-файл на месте, поэтому риск потери формул исходника при экспорте низкий. Риск есть при будущем сценарии “заполнить исходный шаблон”, потому что библиотека `xlsx` не гарантирует полное сохранение стилей/формул при перезаписи шаблона.

## OCR / AI
- Prompt: `server/shelf-recognition/prompt.ts` явно запрещает выдумывать названия, цены и catalog match.
- OpenAI/Gemini клиенты: `server/shelf-recognition/openai.ts`, `server/shelf-recognition/gemini.ts`.
- Текстовый AI для catalog match: `server/text-ai/*`.
- Очередь и обработка OCR: `app/app/monitoring/worker-actions.ts`, `server/ocr-cost.ts`.

## Где хранится состояние
- Основное состояние хранится в Supabase PostgreSQL.
- Фото и Excel-отчеты хранятся в Supabase Storage bucket-ах.
- Клиентское состояние минимально и живет в React forms/components.

## База данных и миграции
- Основная система миграций: Supabase CLI, папка `supabase/migrations`.
- Есть также `db/migrations/0001_foundation.sql` и `db/seed.sql`, которые выглядят как локальный/исторический bootstrap. Главным источником для Supabase deployment считается `supabase/migrations`.
- Ключевые таблицы: `catalog_products`, `catalog_imports`, `catalog_import_rows`, `monitoring_sessions`, `monitoring_photos`, `recognized_items`, `matches`, access/reference таблицы.
- Destructive migrations в текущем изменении не создавались.

## Тесты
До изменений отдельной тестовой инфраструктуры в package scripts не было. Добавлен `npm test` для unit-тестов matching-логики через Node test runner и `tsx`.

## Env-переменные
Из `.env.example` и `lib/env.ts`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_OCR_MODEL` используется кодом, но отсутствовал в `.env.example` до аудита.
- `WORKER_SIGNATURE_SECRET`

## Внешние сервисы
- Supabase Auth/Postgres/Storage.
- OpenAI API для OCR/vision.
- Gemini API опционально по коду адаптера, но env-переменная должна быть уточнена отдельно при включении.
- Vercel для production deployment.

## Хрупкие или недоделанные места
1. Matching был эвристическим и мог давать кандидат по слишком малому числу признаков. Усилен запрет на one-word matching.
2. Нормализация не полностью учитывала упаковку и варианты/ароматы. Добавлен учет упаковки и variant review reason.
3. Импорт XLSX читает только первый лист. Если ассортимент разделен на “Продукты” и “Химия”, нужен явный multi-sheet import.
4. Экспорт создает новый workbook, но не заполняет исходный мониторинговый шаблон. Это безопасно для исходника, но не решает сценарий сохранения чужих формул/стилей.
5. `xlsx` ограниченно сохраняет форматирование при template editing; для будущего safe-template режима нужна отдельная реализация с копией файла.
6. Нет integration-теста импорта/экспорта Excel с реальным workbook fixture.
7. Supabase migration check не запускался локально: в контейнере нет настроенного Supabase project/ref и локальной БД.
8. `npm install` сообщает о 3 vulnerabilities в dependency tree; требуется отдельный dependency audit, так как force update может затронуть Next/React совместимость.
