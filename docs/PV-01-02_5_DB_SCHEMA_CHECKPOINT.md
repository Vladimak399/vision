# PV-01-02.5 — DB schema checkpoint

**Date:** 2026-07-10  
**Task:** PV-01-02.5 — Phase 1 DB schema checkpoint

## Purpose

Freeze the Phase 1 database foundation before moving from schema work into image-processing code.

This checkpoint intentionally contains no application code and no SQL migration. It documents the current state after PV-01-00, PV-01-01, and PV-01-02 were merged into `main`.

## Completed DB foundation

### PV-01-00 — `competitor_shelf_items`

Merged baseline table recovery for `public.competitor_shelf_items` into Supabase migrations.

This made the active shelf-item table reproducible on a fresh database and aligned the repository with the already-existing production table shape.

### PV-01-01 — evidence fields

Merged additive evidence columns into `public.competitor_shelf_items`:

- bbox;
- crop path and crop dimensions;
- detector provider/model/confidence;
- OCR provider/model/text/confidence;
- parsed price confidence;
- normalized product text;
- review status and reason;
- AI usage/cost metadata;
- nullable `processing_run_id` placeholder.

### PV-01-02 — `price_capture_runs`

Merged `public.price_capture_runs` for per-photo/per-upload processing metrics.

The migration also added a nullable foreign key:

```sql
competitor_shelf_items.processing_run_id -> price_capture_runs.id
```

## Current schema direction

The project now has the minimum database foundation for a local-first pipeline:

```txt
photo upload
↓
price_capture_runs row
↓
price tag detections
↓
competitor_shelf_items rows with evidence fields
↓
review queue / catalog matching / Excel export
```

## Production status

No production migrations were applied during PV-01-00 through PV-01-02.5.

Before applying migrations to production, run a separate production migration checkpoint. At minimum, compare production columns and constraints against git migrations:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('competitor_shelf_items', 'price_capture_runs')
ORDER BY table_name, ordinal_position;
```

Also inspect RLS policies:

```sql
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('competitor_shelf_items', 'price_capture_runs')
ORDER BY tablename, policyname;
```

## Gate for next work

After this checkpoint, the next implementation phase may move into image-processing code.

Recommended next task:

```txt
PV-01-03 — crop generator utility
```

Scope for PV-01-03 should remain narrow:

- local utility only;
- no UI;
- no detector integration;
- no OCR integration;
- no AI fallback;
- no production migration;
- no model weights in git;
- tests or at least deterministic fixture-based checks if feasible.

## Explicit non-goals

PV-01-02.5 does not:

- add migrations;
- apply production changes;
- modify app/server code;
- modify export logic;
- modify matching logic;
- modify review UI;
- deploy to Vercel;
- introduce local CV/OCR dependencies.