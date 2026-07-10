-- Migration: 20260710131711_lock_down_unused_golden_dataset_samples
-- Date: 2026-07-10
-- Task: PV-09-07
-- Purpose: Lock down unused golden dataset table after Supabase security advisor
--          reported public table without RLS.
--
-- Context:
--   - public.golden_dataset_samples was empty in production at migration time.
--   - The project is not using golden dataset workflow in the MVP price-capture flow.
--   - Enabling RLS with no policies intentionally blocks anon/authenticated access.
--   - Service role still bypasses RLS for future administrative or migration work.
--
-- Safety:
--   - No data mutation.
--   - No policies added.
--   - No route or UI depends on this table in the active MVP flow.

ALTER TABLE public.golden_dataset_samples ENABLE ROW LEVEL SECURITY;
