create policy item_review_update_extra
on public.recognized_items
for update
using (public.has_company_role(company_id, array['admin','manager','reviewer']::public.member_role[]))
with check (public.has_company_role(company_id, array['admin','manager','reviewer']::public.member_role[]));
