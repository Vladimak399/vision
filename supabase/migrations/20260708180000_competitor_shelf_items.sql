-- Migration: 20260708180000_competitor_shelf_items
-- Date: 2026-07-10
-- Task: PV-01-00
-- Purpose: Recover competitor_shelf_items schema into migrations.
--
-- This table was created directly on production and never committed to git.
-- This migration makes it reproducible on fresh DB without breaking production.
--
-- Strategy:
--   - CREATE TABLE IF NOT EXISTS → safe for fresh DB, no-op on production
--   - ADD COLUMN IF NOT EXISTS → safe for both (photo_filename was added later)
--   - RLS policies: DO $$ block with pg_policies existence check → no overwrite
--   - Trigger: DROP IF EXISTS + CREATE (project standard pattern)
--   - Operations are safe/repeatable for fresh DB and existing DB
--   - Trigger uses DROP IF EXISTS + CREATE as a safe repeatable project pattern

-- ============================================================
-- 1. Create table (idempotent — no-op if table already exists)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.competitor_shelf_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  week smallint NOT NULL CHECK (week IN (1, 2)),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  raw_name text NOT NULL,
  brand text,
  size_text text,
  price_minor bigint,
  old_price_minor bigint,
  promo_price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'RUB',
  price_tag_text text,
  product_visible_text text,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  photo_storage_path text,
  photo_filename text,
  captured_date date NOT NULL DEFAULT CURRENT_DATE,
  catalog_product_id uuid REFERENCES public.catalog_products(id) ON DELETE SET NULL,
  match_confidence numeric(5,4),
  match_reason text,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Add columns that might be missing on production (idempotent)
-- ============================================================
-- photo_filename was added after the initial CREATE TABLE on production
-- (see EXECUTION-ROADMAP.md: "ALTER TABLE ADD COLUMN IF NOT EXISTS photo_filename")
ALTER TABLE public.competitor_shelf_items
  ADD COLUMN IF NOT EXISTS photo_filename text;

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_company_store_week
  ON public.competitor_shelf_items(company_id, store_id, week);

CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_company_catalog
  ON public.competitor_shelf_items(company_id, catalog_product_id);

CREATE INDEX IF NOT EXISTS idx_competitor_shelf_items_captured_date
  ON public.competitor_shelf_items(company_id, store_id, captured_date DESC);

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE public.competitor_shelf_items ENABLE ROW LEVEL SECURITY;

-- Create policies only if they don't exist yet (safe for production).
-- Uses pg_policies system table to check before creating.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'competitor_shelf_items'
      AND policyname = 'competitor_shelf_items_member_select'
  ) THEN
    CREATE POLICY competitor_shelf_items_member_select
      ON public.competitor_shelf_items
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
      AND tablename = 'competitor_shelf_items'
      AND policyname = 'competitor_shelf_items_manager_write'
  ) THEN
    CREATE POLICY competitor_shelf_items_manager_write
      ON public.competitor_shelf_items
      FOR ALL
      USING (public.has_company_role(company_id, ARRAY['admin', 'manager']::public.member_role[]))
      WITH CHECK (public.has_company_role(company_id, ARRAY['admin', 'manager']::public.member_role[]));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'competitor_shelf_items'
      AND policyname = 'competitor_shelf_items_reviewer_update'
  ) THEN
    CREATE POLICY competitor_shelf_items_reviewer_update
      ON public.competitor_shelf_items
      FOR UPDATE
      USING (public.has_company_role(company_id, ARRAY['reviewer']::public.member_role[]))
      WITH CHECK (public.has_company_role(company_id, ARRAY['reviewer']::public.member_role[]));
  END IF;
END
$$;

-- ============================================================
-- 5. Trigger for updated_at
--    Uses project standard pattern: DROP IF EXISTS + CREATE
--    (same as 20260706204000_jobs_updated_at_trigger.sql)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_competitor_shelf_items_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_competitor_shelf_items_updated_at ON public.competitor_shelf_items;

CREATE TRIGGER set_competitor_shelf_items_updated_at
  BEFORE UPDATE ON public.competitor_shelf_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competitor_shelf_items_updated_at();
