-- Monitoring template model: каталог товаров + шаблон недель + цены конкурентов с фото.
-- Новая модель под реальный flow: шаблон Яны (неделя 1/2) → фото полок конкурентов →
-- распознавание → цены проставляются в колонки конкурентов → экспорт того же шаблона.
-- Старые таблицы (monitoring_sessions, recognized_items и т.д.) НЕ трогаем.

-- ============================================================================
-- 1. Расширяем каталог: штрихкод, отдел, категория
-- ============================================================================
alter table public.catalog_products
  add column if not exists barcode text,
  add column if not exists department text,
  add column if not exists category text;

-- department: 'products' (продукты) или 'chemistry' (химия/косметика/гигиена).
-- Совпадает с уже существующей конвенцией в monitoring_photos/recognized_items.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_products_department_check'
      and conrelid = 'public.catalog_products'::regclass
  ) then
    alter table public.catalog_products
      add constraint catalog_products_department_check
      check (department is null or department in ('products', 'chemistry'));
  end if;
end $$;

-- Штрихкод уникален в рамках компании (если задан).
create unique index if not exists catalog_products_barcode_idx
  on public.catalog_products(company_id, barcode)
  where barcode is not null;

-- ============================================================================
-- 2. Признак "наш магазин" в stores (сейчас различаем только по competitor_id).
--    is_own = true → наша ТТ; false → конкурент. Удобно для фильтров и UI.
-- ============================================================================
alter table public.stores
  add column if not exists is_own boolean not null default false;

-- ============================================================================
-- 3. Маппинг шаблона: какие колонки каким магазинам соответствуют в каждой неделе.
--    Шапка шаблона парсится один раз при импорте и сохраняется сюда.
--    При экспорте — по week/store_id находим column_index и подставляем цену.
-- ============================================================================
create table if not exists public.monitor_template_columns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week smallint not null check (week in (1, 2)),
  department text not null check (department in ('products', 'chemistry')),
  column_index integer not null,                -- 0-based индекс колонки в листе
  price_kind text not null check (price_kind in ('own', 'competitor')),
  our_store_id uuid references public.stores(id) on delete cascade,  -- наша ТТ (группа)
  store_id uuid references public.stores(id) on delete cascade,      -- магазин этой колонки
  column_label text,                            -- исходный текст шапки (для отладки/экспорта)
  created_at timestamptz not null default now(),
  -- одна колонка на (компания, неделя, отдел, column_index)
  unique (company_id, week, department, column_index)
);

create index if not exists monitor_template_columns_week_idx
  on public.monitor_template_columns(company_id, week, department);

create index if not exists monitor_template_columns_store_idx
  on public.monitor_template_columns(company_id, store_id);

-- ============================================================================
-- 4. Цены конкурентов с фото — главная ценность приложения.
--    product_id + week + store_id (конкурент) → цена. Перезаписывается при новом обходе.
-- ============================================================================
create table if not exists public.competitor_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week smallint not null check (week in (1, 2)),
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,  -- конкурент
  price_minor bigint,                          -- цена в копейках (null = товара нет у конкурента)
  currency char(3) not null default 'RUB',
  confidence numeric(5,4),                      -- уверенность распознавания 0..1
  source text not null default 'photo' check (source in ('photo', 'manual')),
  photo_storage_path text,                      -- путь к фото-доказательству
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- одна актуальная цена на (товар, неделя, конкурент). Новый обход — upsert.
  unique (company_id, week, product_id, store_id)
);

create index if not exists competitor_prices_export_idx
  on public.competitor_prices(company_id, week, store_id);

create index if not exists competitor_prices_product_idx
  on public.competitor_prices(company_id, week, product_id);

-- updated_at триггер (конвенция проекта).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists competitor_prices_touch on public.competitor_prices;
create trigger competitor_prices_touch
  before update on public.competitor_prices
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS (конвенция проекта — все таблицы под RLS, даже для одного пользователя).
-- ============================================================================
alter table public.monitor_template_columns enable row level security;
alter table public.competitor_prices enable row level security;

-- Политики: доступ через membership (как в существующих таблицах).
-- Компания видит только свои строки. Используем ту же модель, что в catalog_products.
create policy "template_columns_company_select"
  on public.monitor_template_columns for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy "template_columns_company_modify"
  on public.monitor_template_columns for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy "competitor_prices_company_select"
  on public.competitor_prices for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy "competitor_prices_company_modify"
  on public.competitor_prices for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
