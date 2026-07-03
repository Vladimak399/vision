# 03. Архитектура

## Стек

Next.js, TypeScript, Tailwind, shadcn/ui; Server Actions и Route Handlers; Supabase PostgreSQL/Auth/Storage; OpenAI API; ExcelJS; Fuse.js и RapidFuzz; Vercel.

## Компоненты и поток

- `web`: dashboard, catalog, sessions, review, history, reports.
- `application`: авторизация и бизнес-инварианты.
- `recognition`: подготовка изображений и OpenAI structured output.
- `matching`: normalization, aliases, retrieval, scoring, decision.
- `reports`: snapshot и ExcelJS.
- `storage`: private buckets `monitoring-photos` и `reports`.

Поток: `browser → signed upload → Storage → photo job → recognition → matching → review → snapshot → report`.

Долгие операции выполняются worker через идемпотентные jobs; UI получает прогресс polling. UI не получает service-role/OpenAI keys. Recognition не принимает match-решения, Reports читает только completed snapshot.

Transient errors повторяются до трех раз с exponential backoff. Ошибка одного фото не останавливает сессию. Correlation ID связывает сессию, job, AI-вызов и отчет.
