-- Migration: 20260710123000_competitor_shelf_items_evidence_fields
-- Date: 2026-07-10
-- Task: PV-01-01
-- Purpose: Add evidence, local CV/OCR, review, and AI fallback metadata fields
--          to the active competitor_shelf_items table.
--
-- Strategy:
--   - Additive only: ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   - No destructive SQL
--   - No FK to price_capture_runs yet; that table is introduced in PV-01-02
--   - Evidence fields are nullable so the existing flow and rows remain valid
--   - ai_used is NOT NULL with DEFAULT false to preserve safe budget tracking semantics

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

-- Lightweight indexes for the upcoming review queue and processing-run metrics.
-- No FK is added to processing_run_id in PV-01-01 because price_capture_runs
-- is introduced later in PV-01-02.
CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_company_review_status
  ON public.competitor_shelf_items(company_id, review_status);

CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_processing_run_id
  ON public.competitor_shelf_items(processing_run_id);
