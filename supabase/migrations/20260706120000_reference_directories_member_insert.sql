create policy competitors_member_insert on public.competitors
  for insert
  with check (public.is_company_member(company_id));

create policy stores_member_insert on public.stores
  for insert
  with check (public.is_company_member(company_id));
