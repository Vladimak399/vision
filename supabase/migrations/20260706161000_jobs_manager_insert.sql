drop policy if exists jobs_manager_insert on public.jobs;

create policy jobs_manager_insert
on public.jobs
for insert
with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));
