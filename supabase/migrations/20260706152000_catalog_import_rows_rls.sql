-- Add scoped RLS policies for row-level catalog import results.
--
-- `catalog_import_rows` does not carry company_id directly, so every policy
-- scopes access through the parent `catalog_imports.company_id`.
--
-- Select is available to any company member for audit/review visibility.
-- Writes are restricted to admin/manager, matching catalog import ownership.
-- The catalog_product_id check prevents linking an import row to a product from
-- another company when catalog_product_id is present.

drop policy if exists catalog_import_rows_member_select on public.catalog_import_rows;
drop policy if exists catalog_import_rows_manager_insert on public.catalog_import_rows;
drop policy if exists catalog_import_rows_manager_update on public.catalog_import_rows;
drop policy if exists catalog_import_rows_manager_delete on public.catalog_import_rows;

create policy catalog_import_rows_member_select
on public.catalog_import_rows
for select
using (
  exists (
    select 1
    from public.catalog_imports ci
    where ci.id = catalog_import_rows.import_id
      and public.is_company_member(ci.company_id)
  )
);

create policy catalog_import_rows_manager_insert
on public.catalog_import_rows
for insert
with check (
  exists (
    select 1
    from public.catalog_imports ci
    where ci.id = catalog_import_rows.import_id
      and public.has_company_role(ci.company_id, array['admin','manager']::public.member_role[])
      and (
        catalog_import_rows.catalog_product_id is null
        or exists (
          select 1
          from public.catalog_products cp
          where cp.id = catalog_import_rows.catalog_product_id
            and cp.company_id = ci.company_id
        )
      )
  )
);

create policy catalog_import_rows_manager_update
on public.catalog_import_rows
for update
using (
  exists (
    select 1
    from public.catalog_imports ci
    where ci.id = catalog_import_rows.import_id
      and public.has_company_role(ci.company_id, array['admin','manager']::public.member_role[])
  )
)
with check (
  exists (
    select 1
    from public.catalog_imports ci
    where ci.id = catalog_import_rows.import_id
      and public.has_company_role(ci.company_id, array['admin','manager']::public.member_role[])
      and (
        catalog_import_rows.catalog_product_id is null
        or exists (
          select 1
          from public.catalog_products cp
          where cp.id = catalog_import_rows.catalog_product_id
            and cp.company_id = ci.company_id
        )
      )
  )
);

create policy catalog_import_rows_manager_delete
on public.catalog_import_rows
for delete
using (
  exists (
    select 1
    from public.catalog_imports ci
    where ci.id = catalog_import_rows.import_id
      and public.has_company_role(ci.company_id, array['admin','manager']::public.member_role[])
  )
);
