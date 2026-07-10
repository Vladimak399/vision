-- Упрощение модели: убираем хранение структуры шаблона (колонки),
-- оставляем только журнал цен + справочники. Структуру файла Яны берём
-- прямо из файла при каждой выгрузке.

-- 1. Убираем таблицу колонок шаблона — больше не нужна.
drop table if exists public.monitor_template_columns cascade;

-- 2. Убираем старую competitor_prices (данных ещё нет, безопасно).
drop table if exists public.competitor_prices cascade;

-- 3. Журнал цен конкурентов — история по обходам.
--    Один обход = жена сходила в магазин в определённую дату.
--    История сохраняется (несколько записей на товар/магазин в разные даты).
--    При выгрузке берём самую свежую цену для пары (товар, магазин) в рамках недели.
create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week smallint not null check (week in (1, 2)),
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,  -- конкурент
  price_minor bigint,                           -- копейки; null = товара нет у конкурента
  currency char(3) not null default 'RUB',
  confidence numeric(5,4),                       -- уверенность распознавания 0..1
  source text not null default 'photo' check (source in ('photo', 'manual')),
  photo_storage_path text,
  captured_at date not null default current_date,  -- дата обхода (день)
  created_at timestamptz not null default now()
);

-- Быстрый поиск свежих цен: для выгрузки берём max(captured_at).
create index if not exists price_history_export_idx
  on public.price_history(company_id, week, store_id, product_id, captured_at desc);

create index if not exists price_history_product_idx
  on public.price_history(company_id, week, product_id);

-- 4. RLS (та же модель, что везде — доступ через company_members.user_id).
alter table public.price_history enable row level security;

create policy "price_history_company_select"
  on public.price_history for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy "price_history_company_modify"
  on public.price_history for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
