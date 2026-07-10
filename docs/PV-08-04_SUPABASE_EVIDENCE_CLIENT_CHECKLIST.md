# PV-08-04/05 — Supabase evidence client checklist

Status: integration checklist only. Do not enable production writes from this document alone.

## Connected Supabase project

Project name: `vision`

Project id/ref:

```txt
ncefnrodgzhwwxzogbur
```

Project URL:

```txt
https://ncefnrodgzhwwxzogbur.supabase.co
```

Region: `eu-central-1`.

Status observed through Supabase connector: `ACTIVE_HEALTHY`.

## Environment variables

Use the newer publishable key for normal browser/authenticated client flows. Do not commit keys to git.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ncefnrodgzhwwxzogbur.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<paste sb_publishable_... key from Supabase project API settings>
```

Server-side evidence writes require a service-role key, but this must remain server-only.

```bash
SUPABASE_SERVICE_ROLE_KEY=<paste service_role key only in server runtime>
```

Evidence persistence write mode remains blocked unless all three variables are explicitly set:

```bash
PRICEVISION_EVIDENCE_PERSISTENCE_MODE=write
PRICEVISION_EVIDENCE_PERSISTENCE_WRITE_CONFIRM=YES_I_UNDERSTAND_THIS_WRITES_EVIDENCE
PRICEVISION_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM=YES_I_UNDERSTAND_THIS_INSERTS_ONE_TEST_ROW
```

Until the review flow and storage policies are confirmed, keep:

```bash
PRICEVISION_EVIDENCE_PERSISTENCE_MODE=dry_run
PRICEVISION_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM=
```

## Readiness check

After setting server-only Supabase env values locally, run:

```bash
npm run check:evidence-readiness
```

This performs schema probes only. It does not insert, update, or delete data. The check calls `select(...).limit(0)` on `competitor_shelf_items` and `price_capture_runs` to confirm that the evidence columns expected by the pipeline are visible to the configured Supabase client.

## Current production schema observation

`public.competitor_shelf_items` exists and RLS is enabled. On 2026-07-10, additive production migrations were applied for the local evidence fields and `price_capture_runs`.

Do not enable real evidence writes until the live readiness check passes and one controlled test row is explicitly approved.

## Security findings from Supabase advisors

These findings were observed through Supabase security advisors and should be handled in a separate migration/security PR.

### Golden dataset status

`public.golden_dataset_samples` is not used by the current MVP flow. It was empty when checked on 2026-07-10, and RLS has been enabled without policies to lock the unused table down. Supabase now reports this as informational `RLS Enabled No Policy`, which is expected for an intentionally inaccessible unused table.

### Warnings

1. Several functions have mutable `search_path`:
   - `public.calculate_golden_dataset_accuracy`
   - `public.get_pending_golden_samples`
   - `public.touch_updated_at`
2. Several `SECURITY DEFINER` functions are executable by `anon`/`authenticated`:
   - `public.has_company_role(target_company_id uuid, allowed_roles public.member_role[])`
   - `public.is_company_member(target_company_id uuid)`
   - `public.set_recognized_item_department_from_photo()`
3. Auth leaked-password protection is disabled.

These warnings are not fixed by this PR.

## Integration rule

The code may construct a Supabase client boundary, but production writes remain disconnected from routes until all of the following are true:

1. Required evidence columns exist in production and the live readiness check passes.
2. RLS policies for `competitor_shelf_items` are verified.
3. Storage bucket and object policies for source photos/crops are verified.
4. `golden_dataset_samples` remains locked down or gets formal company-scoped policies before use.
5. Evidence write mode is explicitly enabled by env.
6. Controlled single-row insert approval env is explicitly enabled.
7. A small admin-only write path is reviewed separately.
