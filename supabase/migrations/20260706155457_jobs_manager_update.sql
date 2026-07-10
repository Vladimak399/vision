create policy jobs_manager_update
on public.jobs
for update
using (public.has_company_role(company_id, array['admin','manager']::public.member_role[]))
with check (public.has_company_role(company_id, array['admin','manager']::public.member_role[]));
