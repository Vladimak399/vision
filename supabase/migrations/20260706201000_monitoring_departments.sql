alter table public.monitoring_photos
  add column if not exists department text;

alter table public.recognized_items
  add column if not exists department text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'monitoring_photos_department_check'
      and conrelid = 'public.monitoring_photos'::regclass
  ) then
    alter table public.monitoring_photos
      add constraint monitoring_photos_department_check
      check (department is null or department in ('products', 'chemistry'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'recognized_items_department_check'
      and conrelid = 'public.recognized_items'::regclass
  ) then
    alter table public.recognized_items
      add constraint recognized_items_department_check
      check (department is null or department in ('products', 'chemistry'));
  end if;
end $$;

create index if not exists monitoring_photos_department_idx
  on public.monitoring_photos(company_id, session_id, department);

create index if not exists recognized_items_department_idx
  on public.recognized_items(company_id, session_id, department);
