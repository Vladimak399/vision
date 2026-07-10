-- Migration: 20260710124000_price_capture_runs
-- Date: 2026-07-10
-- Task: PV-01-02
-- Purpose: Add processing-run tracking for the photo price-capture pipeline.
--
-- Strategy:
--   - Additive only: create a new table and add a nullable FK constraint
--   - No destructive SQL
--   - Existing competitor_shelf_items rows remain valid because processing_run_id is nullable
--   - The table stores per-photo/per-upload processing metrics for quality and cost control

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
