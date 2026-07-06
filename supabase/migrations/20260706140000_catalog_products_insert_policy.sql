create policy catalog_products_insert on public.catalog_products for insert
  with check (public.is_company_member(company_id));
