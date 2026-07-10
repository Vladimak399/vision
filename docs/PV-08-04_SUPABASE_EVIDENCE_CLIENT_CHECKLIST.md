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

Region: `eu-central-1`

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

Evidence persistence write mode remains blocked unless both variables are explicitly set:

```bash
PRICEVISION_EVIDENCE_PERSISTENCE_MODE=write
PRICEVISION_EVIDENCE_PERSISTENCE_WRITE_CONFIRM=YES_I_UNDERSTAND_THIS_WRITES_EVIDENCE
```

Until the review flow and storage policies are confirmed, keep:

```bash
PRICEVISION_EVIDENCE_PERSISTENCE_MODE=dry_run
```

## Current production schema observation

`public.competitor_shelf_items` exists and RLS is enabled. However, the connected production schema currently has only the older competitor shelf fields:

- `id`
- `company_id`
- `week`
- `store_id`
- `raw_name`
- `brand`
- `size_text`
- `price_minor`
- `old_price_minor`
- `promo_price_minor`
- `currency`
- `price_tag_text`
- `product_visible_text`
- `confidence`
- `photo_storage_path`
- `captured_date`
- `created_at`
- `catalog_product_id`
- `match_confidence`
- `match_reason`
- `matched_at`
- `updated_at`
- `photo_filename`

The production table does not yet include the evidence fields expected by the local PriceVision pipeline, including:

- `bbox`
- `crop_storage_path`
- `crop_width`
- `crop_height`
- `detector_provider`
- `detector_model`
- `detector_confidence`
- `ocr_provider`
- `ocr_model`
- `ocr_text`
- `ocr_confidence`
- `parsed_price_confidence`
- `normalized_product_text`
- `review_status`
- `review_reason`
- `ai_used`
- `ai_reason`
- `ai_provider`
- `ai_model`
- `ai_cost_microusd`
- `processing_run_id`

Do not enable real evidence writes until the DB migration state is aligned.

## Security findings from Supabase advisors

These findings were observed through Supabase security advisors and should be handled in a separate migration/security PR.

### Critical / error

1. `public.golden_dataset_samples` has RLS disabled.
2. `public.golden_dataset_samples` is exposed via API and contains a potentially sensitive column: `session_id`.

Do not auto-apply RLS blindly. Enabling RLS without policies may block legitimate app access. The minimal remediation starts with:

```sql
ALTER TABLE public.golden_dataset_samples ENABLE ROW LEVEL SECURITY;
```

Then add company-scoped policies before relying on the table from the app.

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

These are not fixed by this PR.

## Integration rule

The code may construct a Supabase client boundary, but production writes remain disconnected from routes until all of the following are true:

1. Required evidence columns exist in production.
2. RLS policies for `competitor_shelf_items` are verified.
3. Storage bucket and object policies for source photos/crops are verified.
4. `golden_dataset_samples` RLS issue is handled or formally accepted.
5. Evidence write mode is explicitly enabled by env.
6. A small admin-only write path is reviewed separately.
