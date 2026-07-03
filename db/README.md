# Database

SQL-файлы для Supabase лежат в `db/migrations`.

## Миграции

- `0001_foundation.sql` — базовая доменная схема PriceVision: компании, профили, роли, магазины, конкуренты, каталог, импорт, сессии мониторинга, фото, распознанные позиции, match, aliases, evidence, история цен, отчеты, jobs и audit log.

## Локальный порядок применения

1. Создай Supabase project.
2. Выполни `db/migrations/0001_foundation.sql` в SQL editor или через Supabase CLI.
3. Создай пользователя в Supabase Auth.
4. Выполни `db/seed.sql`, заменив `replace-with-auth-user-id` на реальный UUID пользователя.
5. Добавь значения из `.env.example` в `.env.local`.

## Ролевой доступ

- `admin` управляет пользователями, магазинами, конкурентами и настройками компании.
- `manager` работает с каталогом, сессиями, фото, отчетами и историей.
- `reviewer` видит evidence и может принимать решения по спорным match.
