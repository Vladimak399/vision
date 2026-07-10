# Phase 1 — DB Schema Recovery Plan

**Дата:** 2026-07-10
**Задача:** PV-01-00 — Recover competitor_shelf_items schema into migrations

---

## 1. Проблема

Таблица `competitor_shelf_items`:
- ✅ Существует на production (29+ записей)
- ✅ Используется новым price-capture flow (untracked files)
- ❌ Не описана в git-миграциях (ни в `db/migrations/`, ни в `supabase/migrations/`)
- ❌ Не воспроизводится на fresh DB
- ❌ Нет доступа к production schema через Supabase CLI (Docker не запущен, `supabase link` не выполнялась)

---

## 2. Источники для восстановления схемы

### 2.1. Тип `ShelfItem` в коде (items-table.tsx)

```ts
type ShelfItem = {
  id: string;
  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: string | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
  confidence: number;
  catalog_product_id: string | null;
  match_confidence: number | null;
  match_reason: string | null;
  matched_at: string | null;
  photo_storage_path: string | null;
  photo_filename: string | null;
  captured_date: string;
};
```

### 2.2. INSERT поля (EXECUTION-ROADMAP.md)

```
company_id, week, store_id, raw_name, brand, size_text, price_minor,
old_price_minor, promo_price_minor, currency, price_tag_text,
product_visible_text, confidence, photo_storage_path, captured_date
```

### 2.3. Описание HANDOFF.md

```
Поля: company_id, week, store_id, raw_name, brand, size_text,
price_minor, old_price_minor, promo_price_minor, currency,
price_tag_text, product_visible_text, confidence,
photo_storage_path, photo_filename, captured_date,
catalog_product_id, match_confidence, match_reason, matched_at
RLS включена
```

### 2.4. Известные ALTER TABLE (EXECUTION-ROADMAP.md)

```sql
ALTER TABLE competitor_shelf_items ADD COLUMN IF NOT EXISTS photo_filename text;
```

---

## 3. Schema assumptions verified against code

### 3.1. Проверка FK: store_id

**Источник:** `db/migrations/0001_foundation.sql` (строка 41)

```sql
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete set null,
  name text not null,
  address text, ...
);
```

Таблица `public.competitor_stores` **не существует**. Единственная таблица магазинов — `public.stores`.
✅ В миграции: `store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT`

### 3.2. Проверка FK: catalog_product_id

**Источник:** `db/migrations/0001_foundation.sql` (строка 51)

```sql
create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  external_sku text not null,
  name text not null, ...
);
```

Таблица `public.products` **не существует**. Единственная таблица каталога — `public.catalog_products`.
✅ В миграции: `catalog_product_id uuid REFERENCES public.catalog_products(id) ON DELETE SET NULL`

### 3.3. Проверка week type

**Источник:** `app/app/price-capture/[storeId]/page.tsx` и `price-capture-form.tsx`

```ts
// page.tsx:74
const week: 1 | 2 = weekParam === "2" ? 2 : 1;
// page.tsx:114
.from("competitor_shelf_items")
.eq("week", week) // integer query
```

- Везде используется как `1 | 2` (TypeScript union type)
- Значение передаётся как integer в `.eq("week", week)`
- Нет поддержки week 3+ в коде

✅ В миграции: `week smallint NOT NULL CHECK (week IN (1, 2))`

### 3.4. Проверка raw_name nullability

**Источник:** `app/app/price-capture/[storeId]/items-table.tsx`

```ts
type ShelfItem = {
  raw_name: string; // non-nullable
};
// Используется без null-check:
<td style={rowStyle}>{item.raw_name}</td>
```

**Сравнение с recognized_items (старая таблица):**
```sql
-- foundation.sql
raw_name text not null  -- тоже NOT NULL
```

**Вывод:** Текущий код ожидает `raw_name` как `string`. В будущем draft stage (до OCR) может понадобиться NULL, но это изменение потребует обновления кода (null-check в UI). В рамках PV-01-00 оставляем `NOT NULL` — соответствует текущему коду. Если в будущем понадобится nullable, это будет отдельная миграция.

✅ В миграции: `raw_name text NOT NULL`

### 3.5. Проверка confidence nullability

**Источник:** `app/app/price-capture/[storeId]/items-table.tsx`

```ts
type ShelfItem = {
  confidence: number; // non-nullable
};
// Используется без null-check:
formatConfidence(item.confidence)
```

**Сравнение с recognized_items:**
```sql
confidence numeric(5,4) not null default 0  -- тоже NOT NULL DEFAULT 0
```

**Вывод:** Текущий код ожидает `confidence` как `number`. `DEFAULT 0` корректен — признак того, что уверенность ещё не измерена.

✅ В миграции: `confidence numeric(5,4) NOT NULL DEFAULT 0`

### 3.6. Проверка captured_date

**Источник:** `app/app/price-capture/[storeId]/page.tsx`

```ts
captured_date: string;
// Используется для сортировки:
.order("captured_date", { ascending: false });
```

Название поля содержит `date` (не `at`). Используется для сортировки и фильтрации по неделям. `date` тип в PostgreSQL работает с ORDER BY и возвращается как string через API.

✅ В миграции: `captured_date date NOT NULL DEFAULT CURRENT_DATE`

---

## 4. Восстановленная схема

```sql
create table public.competitor_shelf_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  week smallint NOT NULL CHECK (week IN (1, 2)),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  raw_name text NOT NULL,
  brand text,
  size_text text,
  price_minor bigint,
  old_price_minor bigint,
  promo_price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'RUB',
  price_tag_text text,
  product_visible_text text,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  photo_storage_path text,
  photo_filename text,
  captured_date date NOT NULL DEFAULT CURRENT_DATE,
  catalog_product_id uuid REFERENCES public.catalog_products(id) ON DELETE SET NULL,
  match_confidence numeric(5,4),
  match_reason text,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 4.1. Поля, которых нет в коде, но нужны для consistency

| Поле | Откуда | Зачем |
|------|--------|-------|
| `id` | Стандартный PK | Уникальный идентификатор строки |
| `company_id` | FK | Горизонтальное разделение данных |
| `created_at` | Стандартное поле | Аудит |
| `updated_at` | Стандартное поле | Аудит, auto-update через trigger |

### 4.2. Тип `captured_date`

Восстановлен как `date` (не `timestamptz`), т.к.:
- Название поля содержит `date`, а не `at`
- Используется для фильтрации по неделям и сортировки
- EXECUTION-ROADMAP ссылается как "самая свежая по captured_date"

---

## 5. Миграционная стратегия

### Файл: `supabase/migrations/20260708180000_competitor_shelf_items.sql`

### Безопасность для fresh DB

| Операция | Механизм | Результат |
|----------|----------|-----------|
| CREATE TABLE | `CREATE TABLE IF NOT EXISTS` | Создаёт таблицу с нуля |
| photo_filename | Включена в CREATE TABLE | Есть изначально |
| Indexes | `CREATE INDEX IF NOT EXISTS` | Создаются |
| RLS | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` | Включается |
| RLS policies | `DO $$ ... IF NOT EXISTS (SELECT FROM pg_policies) THEN CREATE POLICY ... END IF; END $$` | Создаются |
| Trigger function | `CREATE OR REPLACE FUNCTION` | Создаётся |
| Trigger | `DROP TRIGGER IF EXISTS ... CREATE TRIGGER` | Создаётся |

### Безопасность для production

| Операция | Механизм защиты | Почему безопасно |
|----------|----------------|------------------|
| CREATE TABLE | `IF NOT EXISTS` | Таблица уже есть → no-op |
| ADD COLUMN photo_filename | `IF NOT EXISTS` | Может уже быть → no-op |
| Indexes | `IF NOT EXISTS` | Могут уже быть → no-op |
| RLS ENABLE | Idempotent | Повторный вызов безопасен |
| RLS policies | `pg_policies` check | Не перетирает существующие |
| Trigger function | `CREATE OR REPLACE` | Обновляет функцию, но логика не меняется |
| Trigger | `DROP IF EXISTS + CREATE` | Пересоздаёт, но это стандартный updated_at trigger |

---

## 6. RLS policies

### Какие policies создаются

| Policy | Тип | Кто имеет доступ |
|--------|-----|-----------------|
| `competitor_shelf_items_member_select` | SELECT | Любой member компании |
| `competitor_shelf_items_manager_write` | INSERT/UPDATE/DELETE | admin, manager |
| `competitor_shelf_items_reviewer_update` | UPDATE | admin, manager, reviewer |

### Почему они не ломают production

- Каждая policy создаётся только **если её ещё нет** в `pg_policies`
- Проверка через `SELECT 1 FROM pg_policies WHERE tablename = 'competitor_shelf_items' AND policyname = '...'`
- Если на production уже есть policies с другими именами → они не трогаются
- Если на production уже есть policy с таким же именем → она не пересоздаётся

### Что делать, если на production уже есть другие policies

1. После применения миграции выполнить:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'competitor_shelf_items';
   ```
2. Сверить с ожидаемыми тремя policy
3. Если есть неожиданные — ничего страшного, они останутся
4. Если нет какой-то из ожидаемых — DO $$ блок создаст её

---

## 7. Trigger

### Что создаётся

```sql
CREATE OR REPLACE FUNCTION public.update_competitor_shelf_items_updated_at()
-- Автоматически обновляет updated_at при UPDATE

DROP TRIGGER IF EXISTS ... CREATE TRIGGER set_competitor_shelf_items_updated_at
-- BEFORE UPDATE ON public.competitor_shelf_items
```

### Безопасность

- `CREATE OR REPLACE FUNCTION` — idempotent, безопасен
- `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` — стандартный паттерн проекта (см. `20260706204000_jobs_updated_at_trigger.sql`)
- Trigger не имеет security-последствий, только аудит updated_at
- Если production уже имеет такой trigger → DROP + CREATE даст тот же результат

---

## 8. Что не меняется в этой задаче

- ❌ Не добавляются evidence fields (bbox, crop, OCR, detector, AI fallback)
- ❌ Не добавляется `processing_run_id`
- ❌ Не меняется старый monitoring flow
- ❌ Не меняются существующие таблицы (кроме ADD COLUMN IF NOT EXISTS photo_filename)
- ❌ Не меняются существующие данные

---

## 9. Риски

1. **Несовпадение схемы** — восстановленная схема основана на документации и коде, не верифицирована против production. Возможны расхождения в:
   - Типах колонок (например, `captured_date` может быть `timestamptz`, а не `date`)
   - Default values
   - Constraints (CHECK, NOT NULL)
   - Дополнительных колонках, не упомянутых в документации

2. **Нет доступа к production** — не можем выполнить `SELECT column_name, data_type, ... FROM information_schema.columns`

3. **RLS policies могут не совпадать** — если на production policies называются иначе, DO $$ блок их не тронет, но они не будут зафиксированы в миграции

### Митигация

После получения доступа к production:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'competitor_shelf_items'
ORDER BY ordinal_position;

SELECT * FROM pg_policies WHERE tablename = 'competitor_shelf_items';
```

Сверить с миграцией и добавить fix migration при расхождениях.

---

## 10. Disclaimer

- ⚠️ **Migration has not been applied to production.**
- ⚠️ **Production schema was not directly verified** — no access to `information_schema.columns` via Supabase CLI.
- ⚠️ **Before production use:** compare actual `information_schema.columns` against this migration:

  ```sql
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'competitor_shelf_items'
  ORDER BY ordinal_position;
  ```
  
  If differences are found, add a separate additive fix migration — do not edit this file retroactively.

---

*Создано в рамках PV-01-00. Миграция не применена на production.*