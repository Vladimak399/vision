create extension if not exists pgcrypto;

create type public.member_role as enum ('admin', 'manager', 'reviewer');
create type public.session_status as enum ('draft', 'uploading', 'processing', 'review', 'completed', 'failed', 'cancelled');
create type public.photo_status as enum ('uploaded', 'queued', 'processing', 'processed', 'failed', 'expired');
create type public.item_status as enum ('recognized', 'matched', 'needs_review', 'unmatched', 'confirmed', 'rejected');
create type public.decision_type as enum ('auto', 'accepted', 'corrected', 'rejected');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete set null,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  external_sku text not null,
  name text not null,
  brand text,
  size_text text,
  own_price_minor bigint,
  currency char(3) not null default 'RUB',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  unique (company_id, external_sku)
);

create table public.catalog_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  filename text not null,
  status text not null default 'draft',
  row_count integer not null default 0,
  error_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create table public.catalog_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.catalog_imports(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  error text,
  catalog_product_id uuid references public.catalog_products(id) on delete set null,
  unique (import_id, row_number)
);

create table public.monitoring_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  status public.session_status not null default 'draft',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  version integer not null default 1
);

create table public.monitoring_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.monitoring_sessions(id) on delete cascade,
  storage_path text not null,
  sha256 text not null,
  status public.photo_status not null default 'uploaded',
  width integer,
  height integer,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (session_id, sha256)
);

create table public.recognized_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.monitoring_sessions(id) on delete cascade,
  photo_id uuid not null references public.monitoring_photos(id) on delete cascade,
  raw_name text not null,
  normalized_name text,
  brand text,
  size_text text,
  price_minor bigint,
  currency char(3) not null default 'RUB',
  confidence numeric(5,4) not null default 0,
  bbox jsonb,
  status public.item_status not null default 'recognized',
  created_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recognized_item_id uuid not null references public.recognized_items(id) on delete cascade,
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  score numeric(5,4) not null default 0,
  decision public.decision_type not null default 'auto',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create unique index matches_one_active_per_item on public.matches(recognized_item_id) where is_active;

create table public.aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  normalized_key text not null,
  catalog_product_id uuid not null references public.catalog_products(id) on delete cascade,
  weight numeric(5,4) not null default 1,
  confirmations integer not null default 1,
  last_confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (company_id, normalized_key, catalog_product_id)
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recognized_item_id uuid not null references public.recognized_items(id) on delete cascade,
  photo_id uuid not null references public.monitoring_photos(id) on delete cascade,
  storage_path text not null,
  bbox jsonb,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now()
);

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  catalog_product_id uuid not null references public.catalog_products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  recognized_item_id uuid not null references public.recognized_items(id) on delete restrict,
  evidence_id uuid not null references public.evidence(id) on delete restrict,
  price_minor bigint not null,
  currency char(3) not null default 'RUB',
  observed_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null references public.monitoring_sessions(id) on delete cascade,
  storage_path text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid references public.monitoring_sessions(id) on delete cascade,
  kind text not null,
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  payload jsonb not null default '{}'::jsonb,
  error text,
  correlation_id text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_company_members_user on public.company_members(user_id);
create index idx_catalog_products_company on public.catalog_products(company_id);
create index idx_monitoring_sessions_company_status on public.monitoring_sessions(company_id, status);
create index idx_monitoring_photos_session_status on public.monitoring_photos(session_id, status);
create index idx_recognized_items_session_status on public.recognized_items(session_id, status);
create index idx_jobs_status_run_after on public.jobs(status, run_after);
create index idx_price_history_product_observed on public.price_history(catalog_product_id, observed_at desc);

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
  );
$$;

create or replace function public.has_company_role(target_company_id uuid, allowed_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
      and cm.role = any(allowed_roles)
  );
$$;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_members enable row level security;
alter table public.competitors enable row level security;
alter table public.stores enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_imports enable row level security;
alter table public.catalog_import_rows enable row level security;
alter table public.monitoring_sessions enable row level security;
alter table public.monitoring_photos enable row level security;
alter table public.recognized_items enable row level security;
alter table public.matches enable row level security;
alter table public.aliases enable row level security;
alter table public.evidence enable row level security;
alter table public.price_history enable row level security;
alter table public.reports enable row level security;
alter table public.jobs enable row level security;
alter table public.audit_events enable row level security;

create policy companies_select on public.companies for select using (public.is_company_member(id));
create policy companies_admin_write on public.companies for all using (public.has_company_role(id, array['admin']::public.member_role[])) with check (public.has_company_role(id, array['admin']::public.member_role[]));

create policy profiles_own_select on public.profiles for select using (id = auth.uid());
create policy profiles_own_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy company_members_select on public.company_members for select using (public.is_company_member(company_id));
create policy company_members_admin_write on public.company_members for all using (public.has_company_role(company_id, array['admin']::public.member_role[])) with check (public.has_company_role(company_id, array['admin']::public.member_role[]));

create policy competitors_member_select on public.competitors for select using (public.is_company_member(company_id));
create policy competitors_admin_write on public.competitors for all using (public.has_company_role(company_id, array['admin']::public.member_role[])) with check (public.has_company_role(company_id, array['admin']::public.member_role[]));

create policy stores_member_select on public.stores for select using (public.is_company_member(company_id));
create policy stores_manager_write on public.stores for all using (public.has_company_role(company_id, array['admin','manager']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));

create policy catalog_member_select on public.catalog_products for select using (public.is_company_member(company_id));
create policy catalog_manager_write on public.catalog_products for all using (public.has_company_role(company_id, array['admin','manager']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));

create policy catalog_imports_member_select on public.catalog_imports for select using (public.is_company_member(company_id));
create policy catalog_imports_manager_write on public.catalog_imports for all using (public.has_company_role(company_id, array['admin','manager']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));

create policy sessions_member_select on public.monitoring_sessions for select using (public.is_company_member(company_id));
create policy sessions_manager_write on public.monitoring_sessions for all using (public.has_company_role(company_id, array['admin','manager']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));

create policy photos_member_select on public.monitoring_photos for select using (public.is_company_member(company_id));
create policy photos_manager_write on public.monitoring_photos for all using (public.has_company_role(company_id, array['admin','manager']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));

create policy recognized_items_member_select on public.recognized_items for select using (public.is_company_member(company_id));
create policy recognized_items_manager_write on public.recognized_items for all using (public.has_company_role(company_id, array['admin','manager']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));

create policy matches_member_select on public.matches for select using (public.is_company_member(company_id));
create policy matches_review_write on public.matches for all using (public.has_company_role(company_id, array['admin','manager','reviewer']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager','reviewer']::public.member_role[]));

create policy aliases_member_select on public.aliases for select using (public.is_company_member(company_id));
create policy aliases_manager_write on public.aliases for all using (public.has_company_role(company_id, array['admin','manager']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));

create policy evidence_member_select on public.evidence for select using (public.is_company_member(company_id));
create policy evidence_manager_write on public.evidence for all using (public.has_company_role(company_id, array['admin','manager','reviewer']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager','reviewer']::public.member_role[]));

create policy price_history_member_select on public.price_history for select using (public.is_company_member(company_id));
create policy reports_member_select on public.reports for select using (public.is_company_member(company_id));
create policy reports_manager_write on public.reports for all using (public.has_company_role(company_id, array['admin','manager']::public.member_role[])) with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));

create policy jobs_manager_select on public.jobs for select using (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));
create policy audit_events_member_select on public.audit_events for select using (public.is_company_member(company_id));
