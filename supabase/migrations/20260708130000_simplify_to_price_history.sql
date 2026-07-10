-- Упрощение модели: убираем хранение структуры шаблона (колонки),
-- оставляем только журнал цен + справочники. Структуру файла Яны берём
-- прямо из файла при каждой выгрузке.

-- 1. Убираем таблицу колонок шаблона — больше не нужна.
drop table if exists public.monitor_template_columns cascade;

-- 2. Убираем старую competitor_prices (данных ещё нет, безопасно).
drop table if exists public.competitor_prices cascade;

-- 3. price_history already exists from the foundation migration.
-- Later migrations add the week/captured_date fields and their indexes.

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
