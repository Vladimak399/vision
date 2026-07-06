alter table public.monitoring_photos
  add column if not exists department text;

alter table public.recognized_items
  add column if not exists department text;

alter table public.monitoring_photos
  add constraint monitoring_photos_department_check
  check (department is null or department in ('products', 'chemistry'));

alter table public.recognized_items
  add constraint recognized_items_department_check
  check (department is null or department in ('products', 'chemistry'));

create index if not exists monitoring_photos_department_idx
  on public.monitoring_photos(company_id, session_id, department);

create index if not exists recognized_items_department_idx
  on public.recognized_items(company_id, session_id, department);
