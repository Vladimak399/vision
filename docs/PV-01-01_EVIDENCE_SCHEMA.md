# PV-01-01 — Evidence schema migration

**Date:** 2026-07-10  
**Task:** PV-01-01 — Evidence schema migration for `competitor_shelf_items`

## Purpose

Add the minimum database fields needed for the local photo-processing pipeline without changing the existing upload, recognition, matching, review, or export flow.

This task only adds schema support for future evidence data:

- bbox from price-tag detector;
- crop storage path and crop dimensions;
- detector provider/model/confidence;
- OCR provider/model/text/confidence;
- parsed price confidence;
- normalized product text;
- review status and review reason;
- AI fallback usage metadata;
- nullable `processing_run_id` placeholder for PV-01-02.

## Migration file

`supabase/migrations/20260710123000_competitor_shelf_items_evidence_fields.sql`

## Strategy

The migration is additive only:

- uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`;
- does not drop, rename, delete, truncate, or rewrite existing data;
- keeps all evidence fields nullable except `ai_used`, which is `NOT NULL DEFAULT false`;
- adds no foreign key to `processing_run_id` yet because `price_capture_runs` is introduced later in PV-01-02;
- adds two lightweight indexes for the future review queue and processing-run metrics.

## Added fields

```sql
bbox jsonb
crop_storage_path text
crop_width integer
crop_height integer

detector_provider text
detector_model text
detector_confidence numeric(5,4)

ocr_provider text
ocr_model text
ocr_text text
ocr_confidence numeric(5,4)

parsed_price_confidence numeric(5,4)
normalized_product_text text

review_status text
review_reason text

ai_used boolean NOT NULL DEFAULT false
ai_reason text
ai_provider text
ai_model text
ai_cost_microusd bigint

processing_run_id uuid
```

## Added indexes

```sql
CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_company_review_status
  ON public.competitor_shelf_items(company_id, review_status);

CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_processing_run_id
  ON public.competitor_shelf_items(processing_run_id);
```

## Why no constraints yet

PV-01-01 intentionally does not add CHECK constraints for confidence ranges or review statuses.

Reason: the actual local detector/OCR/review writers are not implemented yet. Constraints are better added after the writer contracts are stable, otherwise a future agent may create a valid pipeline draft row that the premature constraint rejects.

Recommended follow-up after PV-06 review UI stabilizes:

- add nullable-safe confidence checks;
- add a `review_status` enum or CHECK constraint if the status vocabulary is stable;
- add a foreign key from `processing_run_id` after PV-01-02 creates `price_capture_runs`.

## Safety for existing DB

Existing rows remain valid because new fields are nullable, and `ai_used` receives `false` by default.

The existing AI-first price-capture flow does not need to write these columns. The future local pipeline can gradually populate them without changing old rows.

## Production status

This migration has not been applied to production.

Before applying production migrations, compare production columns against the git schema:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'competitor_shelf_items'
ORDER BY ordinal_position;
```

## Not included in PV-01-01

- No `price_capture_runs` table.
- No crop generator.
- No detector adapter.
- No OCR adapter.
- No UI changes.
- No matching/export changes.
- No AI fallback policy changes.
- No model weights.
- No production migration execution.
