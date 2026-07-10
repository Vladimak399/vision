-- Доработка price_history под flow шаблона Яны.
-- Существующая таблица (из foundation) пустая — добавляем колонки, не дропаем.

-- 1. Неделя обхода (1 или 2) + дата обхода (день, для дедупликации истории).
alter table public.price_history
  add column if not exists week smallint check (week is null or week in (1, 2)),
  add column if not exists captured_date date;

-- Заполняем captured_date из observed_at для совместимости (если когда-то появятся строки).
update public.price_history
  set captured_date = observed_at::date
  where captured_date is null and observed_at is not null;

-- 2. Индексы для быстрого поиска свежих цен при выгрузке:
--    для пары (магазин, товар) в рамках недели — самая свежая дата.
create index if not exists price_history_export_idx
  on public.price_history(company_id, week, store_id, catalog_product_id, captured_date desc)
  where week is not null;

create index if not exists price_history_product_idx
  on public.price_history(company_id, week, catalog_product_id)
  where week is not null;

-- 3. Дополняем RLS: существующая policy price_history_member_select уже работает
--    через company_members (проверено). Дополнительная modify-политика для вставки.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'price_history'
      and policyname = 'price_history_member_modify'
  ) then
    create policy price_history_member_modify
      on public.price_history for all
      using (company_id in (
        select cm.company_id from public.company_members cm
        where cm.user_id = auth.uid()
      ))
      with check (company_id in (
        select cm.company_id from public.company_members cm
        where cm.user_id = auth.uid()
      ));
  end if;
end $$;

-- 4. Убираем лишние таблицы от прошлой попытки (пустые, данных нет).
drop table if exists public.monitor_template_columns cascade;
