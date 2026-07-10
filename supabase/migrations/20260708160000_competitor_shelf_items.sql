-- Двухэтапная модель: распознавание отдельно, сопоставление отдельно.
-- Таблица признанных товаров полки конкурента. Заполняется на Этапе 1 (распознавание фото),
-- а catalog_product_id проставляется на Этапе 2 (сопоставление с каталогом).
-- Это позволяет: не платить дважды за распознавание, хранить ВСЕ товары конкурента
-- (даже не из нашего каталога), перепрогонять сопоставление отдельно.

create table if not exists public.competitor_shelf_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week smallint not null check (week in (1, 2)),
  store_id uuid not null references public.stores(id) on delete cascade,

  -- Данные распознавания (Этап 1)
  raw_name text,
  brand text,
  size_text text,
  price_minor bigint,
  old_price_minor bigint,
  promo_price_minor bigint,
  currency char(3) not null default 'RUB',
  price_tag_text text,
  product_visible_text text,
  confidence numeric(5,4) default 0,
  photo_storage_path text,
  captured_date date not null default current_date,
  created_at timestamptz not null default now(),

  -- Результат сопоставления с каталогом (Этап 2 — null до сопоставления)
  catalog_product_id uuid references public.catalog_products(id) on delete set null,
  match_confidence numeric(5,4),
  match_reason text,
  matched_at timestamptz
);

-- Быстрый поиск: все товары магазина за неделю.
create index if not exists competitor_shelf_items_store_idx
  on public.competitor_shelf_items(company_id, week, store_id, captured_date desc);

-- Поиск несопоставленных для Этапа 2.
create index if not exists competitor_shelf_items_unmatched_idx
  on public.competitor_shelf_items(company_id, week, store_id)
  where catalog_product_id is null;

create index if not exists competitor_shelf_items_matched_idx
  on public.competitor_shelf_items(company_id, week, store_id, catalog_product_id)
  where catalog_product_id is not null;

-- updated_at для триггеров.
alter table public.competitor_shelf_items
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists competitor_shelf_items_touch on public.competitor_shelf_items;
create trigger competitor_shelf_items_touch
  before update on public.competitor_shelf_items
  for each row execute function public.touch_updated_at();

-- RLS — та же модель, доступ через company_members.user_id.
alter table public.competitor_shelf_items enable row level security;

create policy "shelf_items_company_select"
  on public.competitor_shelf_items for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy "shelf_items_company_modify"
  on public.competitor_shelf_items for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
