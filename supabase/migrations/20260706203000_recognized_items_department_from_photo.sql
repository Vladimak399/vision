create or replace function public.set_recognized_item_department_from_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department is null and new.photo_id is not null then
    select department
      into new.department
    from public.monitoring_photos
    where id = new.photo_id
      and company_id = new.company_id
      and session_id = new.session_id;
  end if;

  return new;
end;
$$;

drop trigger if exists set_recognized_item_department_from_photo on public.recognized_items;

create trigger set_recognized_item_department_from_photo
before insert or update of photo_id, department
on public.recognized_items
for each row
execute function public.set_recognized_item_department_from_photo();

update public.recognized_items ri
set department = mp.department
from public.monitoring_photos mp
where ri.department is null
  and ri.photo_id = mp.id
  and ri.company_id = mp.company_id
  and ri.session_id = mp.session_id
  and mp.department is not null;
