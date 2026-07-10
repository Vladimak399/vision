-- Alerts для онлайн-мониторинга — TASK-21.10
-- Правила алертов и список сгенерированных алертов
-- Email/Telegram — отдельная задача, здесь только UI badge + список

-- Таблица правил алертов
create table if not exists public.online_price_alert_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid references public.online_sources(id) on delete cascade,
  name text not null,
  -- Тип алерта: competitor_cheaper — конкурент дешевле на N%; price_change — цена изменилась > N%; out_of_stock — товар пропал; run_failure — run падает подряд
  alert_type text not null check (alert_type in ('competitor_cheaper', 'price_change', 'out_of_stock', 'run_failure')),
  -- Для price_change: порог в % (integer). Для run_failure: количество подряд (integer).
  threshold numeric(8,2) not null default 10,
  -- Порог для competitor_cheaper: сравнивать с ценой из какой-то таблицы/столбца (future: own_price)
  enabled boolean not null default true,
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists online_price_alert_rules_company_idx
  on public.online_price_alert_rules(company_id, enabled);
create index if not exists online_price_alert_rules_source_idx
  on public.online_price_alert_rules(source_id);

-- Таблица сгенерированных алертов
create table if not exists public.online_price_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rule_id uuid references public.online_price_alert_rules(id) on delete set null,
  source_id uuid references public.online_sources(id) on delete cascade,
  run_id uuid references public.online_source_runs(id) on delete set null,
  alert_type text not null check (alert_type in ('competitor_cheaper', 'price_change', 'out_of_stock', 'run_failure')),
  severity text not null check (severity in ('info', 'warning', 'critical')) default 'warning',
  title text not null,
  description text,
  metadata jsonb,
  -- Статус: new, ack (пользователь увидел), resolved
  status text not null check (status in ('new', 'ack', 'resolved')) default 'new',
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  triggered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists online_price_alerts_company_idx
  on public.online_price_alerts(company_id, status, triggered_at desc);
create index if not exists online_price_alerts_type_idx
  on public.online_price_alerts(company_id, alert_type, triggered_at desc);
create index if not exists online_price_alerts_source_idx
  on public.online_price_alerts(company_id, source_id, triggered_at desc);

-- updated_at триггеры
alter table public.online_price_alert_rules
  add column if not exists updated_at timestamptz not null default now();

create trigger online_price_alert_rules_touch
  before update on public.online_price_alert_rules
  for each row execute function public.touch_updated_at();

-- RLS политики
alter table public.online_price_alert_rules enable row level security;
alter table public.online_price_alerts enable row level security;

create policy online_price_alert_rules_company_select
  on public.online_price_alert_rules for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_price_alert_rules_company_modify
  on public.online_price_alert_rules for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));

create policy online_price_alerts_company_select
  on public.online_price_alerts for select
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
create policy online_price_alerts_company_modify
  on public.online_price_alerts for all
  using (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ))
  with check (company_id in (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
  ));
