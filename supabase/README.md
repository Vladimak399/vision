# Supabase setup

This folder uses the standard Supabase project layout.

## Apply the first migration manually

Open Supabase Dashboard, then SQL Editor, then run:

`supabase/migrations/20260703132000_foundation.sql`

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
