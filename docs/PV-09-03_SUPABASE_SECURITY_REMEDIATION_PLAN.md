# PV-09-03 — Supabase security remediation plan

Status: **plan only**. No SQL has been applied from this document.

## Supabase advisor findings

Supabase advisors reported security findings in project `vision` (`ncefnrodgzhwwxzogbur`).

Critical / error findings:

1. `public.golden_dataset_samples` has RLS disabled.
2. `public.golden_dataset_samples` is exposed through the API and contains potentially sensitive columns such as `session_id`.

Warnings:

1. Several functions have mutable `search_path`.
2. Several `SECURITY DEFINER` functions are executable by `anon` and `authenticated` roles:
   - `public.has_company_role(target_company_id uuid, allowed_roles public.member_role[])`
   - `public.is_company_member(target_company_id uuid)`
   - `public.set_recognized_item_department_from_photo()`

Do not apply blanket revokes without checking existing RLS policies. The current project appears to use `has_company_role` and `is_company_member` inside policies, so careless changes could break normal application access.

## Priority 1: protect `golden_dataset_samples`

The immediate risk is that `public.golden_dataset_samples` is in an exposed schema and RLS is disabled. Enabling RLS without policies blocks all anon/authenticated access, which may be acceptable for an internal golden dataset, but it must be intentional.

Recommended policy approach:

- Admin/manager/reviewer members can read rows for their company.
- Admin/manager members can insert/update/delete rows for their company.
- Keep the table inaccessible to users outside the company.

Draft SQL:

```sql
ALTER TABLE public.golden_dataset_samples ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'golden_dataset_samples'
      AND policyname = 'golden_dataset_samples_member_select'
  ) THEN
    CREATE POLICY golden_dataset_samples_member_select
      ON public.golden_dataset_samples
      FOR SELECT
      USING (public.has_company_role(company_id, ARRAY['admin', 'manager', 'reviewer']::public.member_role[]));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'golden_dataset_samples'
      AND policyname = 'golden_dataset_samples_manager_write'
  ) THEN
    CREATE POLICY golden_dataset_samples_manager_write
      ON public.golden_dataset_samples
      FOR ALL
      USING (public.has_company_role(company_id, ARRAY['admin', 'manager']::public.member_role[]))
      WITH CHECK (public.has_company_role(company_id, ARRAY['admin', 'manager']::public.member_role[]));
  END IF;
END
$$;
```

If golden dataset management is intended to be server-only, use a stricter approach instead:

```sql
ALTER TABLE public.golden_dataset_samples ENABLE ROW LEVEL SECURITY;
```

and do not add client-access policies. Then only service-role operations can manage this table.

## Priority 2: function search_path hardening

Supabase warned that functions have mutable `search_path`. For security-definer functions, use explicit `SET search_path = public` or a narrower schema list.

Review these functions:

```txt
public.calculate_golden_dataset_accuracy
public.get_pending_golden_samples
public.touch_updated_at
```

Draft pattern:

```sql
CREATE OR REPLACE FUNCTION public.example_function(...)
RETURNS ...
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- existing body
END;
$$;
```

Do not rewrite function bodies without fetching their current definitions first.

## Priority 3: SECURITY DEFINER execute privileges

Supabase warned that these security-definer functions are executable by exposed roles:

```txt
public.has_company_role(target_company_id uuid, allowed_roles public.member_role[])
public.is_company_member(target_company_id uuid)
public.set_recognized_item_department_from_photo()
```

Important distinction:

- `has_company_role` and `is_company_member` may intentionally be callable because RLS policies depend on them.
- `set_recognized_item_department_from_photo()` appears trigger-like and may not need exposed RPC execution.

Recommended next step before any revoke:

```sql
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS security_definer,
  p.proacl AS privileges,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'has_company_role',
    'is_company_member',
    'set_recognized_item_department_from_photo'
  );
```

Possible revoke for trigger-only function after review:

```sql
REVOKE EXECUTE ON FUNCTION public.set_recognized_item_department_from_photo() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_recognized_item_department_from_photo() FROM authenticated;
```

Do not revoke `has_company_role` or `is_company_member` until all policies that call them are audited.

## Completion criteria

Security remediation is complete when:

1. `public.golden_dataset_samples` has RLS enabled.
2. Either safe company policies exist for `golden_dataset_samples`, or the table is intentionally service-role-only.
3. Mutable `search_path` warnings are resolved or explicitly accepted.
4. `SECURITY DEFINER` warnings are resolved or documented as intentional.
5. Supabase advisors no longer show critical/error findings for exposed-schema RLS.
