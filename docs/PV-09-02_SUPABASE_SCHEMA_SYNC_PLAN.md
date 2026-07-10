# PV-09-02 — Supabase schema sync plan for PriceVision evidence

Status: **plan only**. Do not run automatically from the app, CI, Vercel, or an agent without an explicit operator decision.

## Current finding

Supabase project observed through connector:

- Project: `vision`
- Ref: `ncefnrodgzhwwxzogbur`
- URL: `https://ncefnrodgzhwwxzogbur.supabase.co`
- Region: `eu-central-1`
- Status: `ACTIVE_HEALTHY`

The production table `public.competitor_shelf_items` exists and has RLS enabled, but it does not yet include the PriceVision evidence fields introduced in repository migrations:

- `supabase/migrations/20260710123000_competitor_shelf_items_evidence_fields.sql`
- `supabase/migrations/20260710124000_price_capture_runs.sql`

Observed production `public.competitor_shelf_items` columns already include the legacy price/match fields such as `raw_name`, `price_minor`, `catalog_product_id`, `match_confidence`, `match_reason`, and `matched_at`.

Missing for the local CV/OCR/evidence pipeline:

```txt
bbox
crop_storage_path
crop_width
crop_height
detector_provider
detector_model
detector_confidence
ocr_provider
ocr_model
ocr_text
ocr_confidence
parsed_price_confidence
normalized_product_text
review_status
review_reason
ai_used
ai_reason
ai_provider
ai_model
ai_cost_microusd
processing_run_id
```

The production schema also did not show `public.price_capture_runs` in the connector table list, so the run-tracking migration still needs to be applied or verified.

## Safe execution order

Use Supabase SQL editor or `supabase db push` only after reviewing the SQL below.

Order:

1. Apply additive evidence fields to `public.competitor_shelf_items`.
2. Create `public.price_capture_runs`.
3. Add nullable FK from `competitor_shelf_items.processing_run_id` to `price_capture_runs(id)`.
4. Re-run schema status check.
5. Only after schema is synced, consider enabling guarded evidence writes.

## SQL plan: evidence columns

This is additive and idempotent because it uses `ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.

```sql
ALTER TABLE public.competitor_shelf_items
  ADD COLUMN IF NOT EXISTS bbox jsonb,
  ADD COLUMN IF NOT EXISTS crop_storage_path text,
  ADD COLUMN IF NOT EXISTS crop_width integer,
  ADD COLUMN IF NOT EXISTS crop_height integer,

  ADD COLUMN IF NOT EXISTS detector_provider text,
  ADD COLUMN IF NOT EXISTS detector_model text,
  ADD COLUMN IF NOT EXISTS detector_confidence numeric(5,4),

  ADD COLUMN IF NOT EXISTS ocr_provider text,
  ADD COLUMN IF NOT EXISTS ocr_model text,
  ADD COLUMN IF NOT EXISTS ocr_text text,
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric(5,4),

  ADD COLUMN IF NOT EXISTS parsed_price_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS normalized_product_text text,

  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS review_reason text,

  ADD COLUMN IF NOT EXISTS ai_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_reason text,
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_cost_microusd bigint,

  ADD COLUMN IF NOT EXISTS processing_run_id uuid;

CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_company_review_status
  ON public.competitor_shelf_items(company_id, review_status);

CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_processing_run_id
  ON public.competitor_shelf_items(processing_run_id);
```

## SQL plan: `price_capture_runs`

```sql
CREATE TABLE IF NOT EXISTS public.price_capture_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  week smallint NOT NULL CHECK (week IN (1, 2)),

  photo_storage_path text,
  photo_filename text,
  photo_sha256 text,

  status text NOT NULL DEFAULT 'pending',
  error_message text,

  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms bigint,

  detected_count integer NOT NULL DEFAULT 0,
  crop_count integer NOT NULL DEFAULT 0,
  ocr_success_count integer NOT NULL DEFAULT 0,
  parsed_price_count integer NOT NULL DEFAULT 0,
  auto_matched_count integer NOT NULL DEFAULT 0,
  needs_review_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  ai_calls_count integer NOT NULL DEFAULT 0,
  ai_cost_microusd bigint NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT price_capture_runs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  CONSTRAINT price_capture_runs_non_negative_counts_check
    CHECK (
      detected_count >= 0
      AND crop_count >= 0
      AND ocr_success_count >= 0
      AND parsed_price_count >= 0
      AND auto_matched_count >= 0
      AND needs_review_count >= 0
      AND unmatched_count >= 0
      AND ai_calls_count >= 0
      AND ai_cost_microusd >= 0
    ),
  CONSTRAINT price_capture_runs_duration_non_negative_check
    CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_price_capture_runs_company_store_week
  ON public.price_capture_runs(company_id, store_id, week);

CREATE INDEX IF NOT EXISTS idx_price_capture_runs_company_status
  ON public.price_capture_runs(company_id, status);

CREATE INDEX IF NOT EXISTS idx_price_capture_runs_started_at
  ON public.price_capture_runs(company_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_capture_runs_photo_sha256
  ON public.price_capture_runs(company_id, photo_sha256);

ALTER TABLE public.price_capture_runs ENABLE ROW LEVEL SECURITY;
```

## SQL plan: policies and trigger

These policies follow the existing project pattern of company membership checks.

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_capture_runs'
      AND policyname = 'price_capture_runs_member_select'
  ) THEN
    CREATE POLICY price_capture_runs_member_select
      ON public.price_capture_runs
      FOR SELECT
      USING (public.is_company_member(company_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_capture_runs'
      AND policyname = 'price_capture_runs_manager_write'
  ) THEN
    CREATE POLICY price_capture_runs_manager_write
      ON public.price_capture_runs
      FOR ALL
      USING (public.has_company_role(company_id, ARRAY['admin', 'manager']::public.member_role[]))
      WITH CHECK (public.has_company_role(company_id, ARRAY['admin', 'manager']::public.member_role[]));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.update_price_capture_runs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_price_capture_runs_updated_at ON public.price_capture_runs;

CREATE TRIGGER set_price_capture_runs_updated_at
  BEFORE UPDATE ON public.price_capture_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_price_capture_runs_updated_at();
```

## SQL plan: nullable FK

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'competitor_shelf_items_processing_run_id_fkey'
      AND conrelid = 'public.competitor_shelf_items'::regclass
  ) THEN
    ALTER TABLE public.competitor_shelf_items
      ADD CONSTRAINT competitor_shelf_items_processing_run_id_fkey
      FOREIGN KEY (processing_run_id)
      REFERENCES public.price_capture_runs(id)
      ON DELETE SET NULL;
  END IF;
END
$$;
```

## Post-apply checks

After applying the SQL, verify:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'competitor_shelf_items'
  AND column_name IN (
    'bbox',
    'crop_storage_path',
    'detector_provider',
    'ocr_text',
    'normalized_product_text',
    'processing_run_id'
  )
ORDER BY column_name;

SELECT to_regclass('public.price_capture_runs') AS price_capture_runs_regclass;
```

Keep `PRICEVISION_EVIDENCE_PERSISTENCE_MODE=dry_run` until these checks pass and the RLS/security remediation plan is reviewed.
