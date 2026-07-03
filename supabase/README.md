# Supabase setup

This folder uses the standard Supabase project layout.

## GitHub Integration

Supabase GitHub Integration reads this folder from the repository.

Use these settings in Supabase Dashboard:

- Repository: `Vladimak399/vision`
- Working directory: `.`
- Production branch: `main`
- Deploy to production: enabled

When a commit reaches `main`, Supabase can apply new files from `supabase/migrations` automatically.

## Migrations

- `20260703132000_foundation.sql` creates the main database schema, roles and RLS policies.
- `20260703133000_storage_buckets.sql` creates private Storage buckets for monitoring photos and Excel reports.

## Local CLI flow

Install Supabase CLI, then run:

`supabase login`
`supabase link --project-ref YOUR_PROJECT_REF`
`supabase db push`

## Required environment variables

Copy values from Supabase Dashboard into `.env.local` and Vercel:

`NEXT_PUBLIC_SUPABASE_URL`
`NEXT_PUBLIC_SUPABASE_ANON_KEY`
`SUPABASE_SERVICE_ROLE_KEY`

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in client components. It is only for server-side workers and protected server actions.

## Storage path convention

Files in private buckets must start with the company UUID:

`company_id/session_id/file_name.jpg`
`company_id/report_id/file_name.xlsx`

Storage policies use the first folder segment as `company_id`.
