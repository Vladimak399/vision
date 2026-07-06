create or replace function public.set_jobs_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_jobs_updated_at on public.jobs;

create trigger set_jobs_updated_at
before update on public.jobs
for each row
execute function public.set_jobs_updated_at();
