-- Онлайн-мониторинг сайтов конкурентов
-- Схема для сбора цен с онлайн-каталогов (SPAR, METRO, Magnit, X5/5ka)
-- НЕ расширяем competitor_shelf_items — отдельный lifecycle для онлайн-данных

-- Таблица источников онлайн-цен
create table if not exists public.online_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  source_key text not null check (source_key in ('spar_online', 'metro_online', 'magnit', 'x5_5ka')),
  display_name text not null,
  base_url text not null,
  enabled boolean not null default false,
  parser_version text not null default '1.0.0',
  legal_status text not null check (legal_status in ('pending', 'allowed', 'blocked')) default 'pending',
  rate_limit_per_minute integer not null default 60,
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Уникальный source_key на компанию
create unique index if not exists online_sources_company_key_idx
  on public.online_sources(company_id, source_key);

-- Таблица привязки магазинов к онлайн-источникам
create table if not exists public.online_source_stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.online_sources(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  source_store_id text,
  source_city text,
  source_address text,
  source_region text,
  price_context text check (price_context in ('online_delivery', 'store_visit', 'catalog_promo')),
  enabled boolean not null default true,
  config jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Индексы для быстрого поиска по store и source
create index if not exists online_source_stores_source_idx
  on public.online_source_stores(source_id, store_id);
create index if not exists online_source_stores_company_idx
  on public.online_source_stores(company_id, store_id);

-- Таблица запусков парсинга (runs)
create table if not exists public.online_source_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.online_sources(id) on delete cascade,
  source_store_id text,
  trigger text not null check (trigger in ('cron', 'manual', 'retry')),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')) default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  parser_version text not null,
  stats jsonb,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Индексы для runs
create index if not exists online_source_runs_status_idx
  on public.online_source_runs(company_id, status, started_at desc);
create index if not exists online_source_runs_source_idx
  on public.online_source_runs(source_id, started_at desc);

-- Таблица событий парсинга (логирование)
create table if not exists public.online_source_run_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_id uuid not null references public.online_source_runs(id) on delete cascade,
  level text not null check (level in ('info', 'warn', 'error')),
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists online_source_run_events_run_idx
  on public.online_source_run_events(run_id, created_at);

-- Таблица товаров из онлайн-источников
create table if not exists public.online_source_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.online_sources(id) on delete cascade,
  source_product_id text not null,
  url text,
  raw_name text,
  normalized_name text,
  brand text,
  size_text text,
  barcode text,
  category_path text,
  image_url text,
  metadata jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Уникальность товара внутри источника
create unique index if not exists online_source_products_unique_idx
  on public.online_source_products(company_id, source_id, source_product_id);

-- Индексы для поиска товаров
create index if not exists online_source_products_barcode_idx
  on public.online_source_products(company_id, barcode) where barcode is not null;
create index if not exists online_source_products_name_idx
  on public.online_source_products(company_id, source_id, normalized_name);

-- Таблица сопоставления онлайн-товаров с каталогом
create table if not exists public.online_product_matches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_product_id uuid not null references public.online_source_products(id) on delete cascade,
  catalog_product_id uuid references public.catalog_products(id) on delete set null,
  confidence numeric(5,4),
  method text not null check (method in ('barcode', 'fuzzy', 'llm', 'manual')),
  status text not null check (status in ('auto', 'needs_review', 'confirmed', 'rejected')) default 'auto',
  reason text,
  matched_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Индексы для matching
create index if not exists online_product_matches_source_idx
  on public.online_product_matches(company_id, source_product_id);
create index if not exists online_product_matches_catalog_idx
  on public.online_product_matches(company_id, catalog_product_id) where catalog_product_id is not null;
create index if not exists online_product_matches_status_idx
  on public.online_product_matches(company_id, source_product_id, status)
  where status in ('auto', 'confirmed');

-- Таблица цен из онлайн-источников
create table if not exists public.online_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_id uuid not null references public.online_source_runs(id) on delete cascade,
  source_id uuid not null references public.online_sources(id) on delete cascade,
  source_store_id text,
  store_id uuid not null references public.stores(id) on delete cascade,
  source_product_id uuid not null references public.online_source_products(id) on delete cascade,
  catalog_product_id uuid references public.catalog_products(id) on delete set null,
  price_minor bigint,
  old_price_minor bigint,
  promo_price_minor bigint,
  currency char(3) not null default 'RUB',
  availability text check (availability in ('in_stock', 'out_of_stock', 'unknown')),
  observed_at timestamptz not null default now(),
  source_url text,
  raw_payload_hash text,
  created_at timestamptz not null default now()
);

-- Индексы для цен
create index if not exists online_prices_lookup_idx
  on public.online_prices(company_id, store_id, catalog_product_id, observed_at desc);
create index if not exists online_prices_source_idx
  on public.online_prices(company_id, source_id, source_product_id, observed_at desc);
create index if not exists online_prices_run_idx
  on public.online_prices(run_id);

-- updated_at триггеры
alter table public.online_sources
  add column if not exists updated_at timestamptz not null default now();
alter table public.online_source_stores
  add column if not exists updated_at timestamptz not null default now();
alter table public.online_source_runs
  add column if not exists updated_at timestamptz not null default now();
alter table public.online_source_products
  add column if not exists updated_at timestamptz not null default now();
alter table public.online_product_matches
  add column if not exists updated_at timestamptz not null default now();

create trigger online_sources_touch
  before update on public.online_sources
  for each row execute function public.touch_updated_at();
create trigger online_source_stores_touch
  before update on public.online_source_stores
  for each row execute function public.touch_updated_at();
create trigger online_source_runs_touch
  before update on public.online_source_runs
  for each row execute function public.touch_updated_at();
create trigger online_source_products_touch
  before update on public.online_source_products
  for each row execute function public.touch_updated_at();
create trigger online_product_matches_touch
  before update on public.online_product_matches
  for each row execute function public.touch_updated_at();

-- RLS политики (доступ через company_members.user_id)
alter table public.online_sources enable row level security;
alter table public.online_source_stores enable row level security;
alter table public.online_source_runs enable row level security;
alter table public.online_source_run_events enable row level security;
alter table public.online_source_products enable row level security;
alter table public.online_product_matches enable row level security;
alter table public.online_prices enable row level security;

create policy online_sources_company_select
  on public.online_sources for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_sources_company_modify
  on public.online_sources for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy online_source_stores_company_select
  on public.online_source_stores for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_source_stores_company_modify
  on public.online_source_stores for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy online_source_runs_company_select
  on public.online_source_runs for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_source_runs_company_modify
  on public.online_source_runs for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy online_source_run_events_company_select
  on public.online_source_run_events for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_source_run_events_company_modify
  on public.online_source_run_events for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy online_source_products_company_select
  on public.online_source_products for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_source_products_company_modify
  on public.online_source_products for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy online_product_matches_company_select
  on public.online_product_matches for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_product_matches_company_modify
  on public.online_product_matches for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy online_prices_company_select
  on public.online_prices for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_prices_company_modify
  on public.online_prices for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
