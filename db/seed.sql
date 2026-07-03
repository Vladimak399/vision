-- Local development seed.
-- Replace the user_id value with your auth.users.id after creating a user in Supabase Auth.

insert into public.companies (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Суперцены')
on conflict do nothing;

insert into public.competitors (company_id, name)
values ('00000000-0000-0000-0000-000000000001', 'SPAR')
on conflict do nothing;

insert into public.stores (company_id, name, address)
values ('00000000-0000-0000-0000-000000000001', 'Тестовый магазин', 'Калининград')
on conflict do nothing;

-- Example after auth user exists:
-- insert into public.profiles (id, display_name)
-- values ('replace-with-auth-user-id', 'Влад')
-- on conflict (id) do update set display_name = excluded.display_name;
--
-- insert into public.company_members (company_id, user_id, role)
-- values ('00000000-0000-0000-0000-000000000001', 'replace-with-auth-user-id', 'admin')
-- on conflict (company_id, user_id) do update set role = excluded.role;
