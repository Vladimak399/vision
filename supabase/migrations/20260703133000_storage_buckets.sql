insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('monitoring-photos', 'monitoring-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('reports', 'reports', false, 52428800, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy monitoring_photos_read on storage.objects
for select
to authenticated
using (
  bucket_id = 'monitoring-photos'
  and public.is_company_member(((storage.foldername(name))[1])::uuid)
);

create policy monitoring_photos_insert on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'monitoring-photos'
  and public.has_company_role(((storage.foldername(name))[1])::uuid, array['admin','manager']::public.member_role[])
);

create policy monitoring_photos_update on storage.objects
for update
to authenticated
using (
  bucket_id = 'monitoring-photos'
  and public.has_company_role(((storage.foldername(name))[1])::uuid, array['admin','manager']::public.member_role[])
)
with check (
  bucket_id = 'monitoring-photos'
  and public.has_company_role(((storage.foldername(name))[1])::uuid, array['admin','manager']::public.member_role[])
);

create policy reports_read on storage.objects
for select
to authenticated
using (
  bucket_id = 'reports'
  and public.is_company_member(((storage.foldername(name))[1])::uuid)
);

create policy reports_insert on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'reports'
  and public.has_company_role(((storage.foldername(name))[1])::uuid, array['admin','manager']::public.member_role[])
);
