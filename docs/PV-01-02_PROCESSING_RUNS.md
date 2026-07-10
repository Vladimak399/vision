# PV-01-02 — Processing runs schema

**Date:** 2026-07-10  
**Task:** PV-01-02 — Add `price_capture_runs`

## Purpose

Add a database table for tracking each photo-processing run in the future local pipeline.

The table is needed to measure quality, speed, and paid-AI usage per uploaded photo or processing attempt.

## Migration file

`supabase/migrations/20260710124000_price_capture_runs.sql`

## What was added

### New table

`public.price_capture_runs`

Main fields:

```sql
id uuid primary key
company_id uuid not null
store_id uuid not null
week smallint not null
photo_storage_path text
photo_filename text
photo_sha256 text
status text not null default 'pending'
error_message text
started_at timestamptz not null default now()
finished_at timestamptz
duration_ms bigint

detected_count integer not null default 0
crop_count integer not null default 0
ocr_success_count integer not null default 0
parsed_price_count integer not null default 0
auto_matched_count integer not null default 0
needs_review_count integer not null default 0
unmatched_count integer not null default 0
ai_calls_count integer not null default 0
ai_cost_microusd bigint not null default 0

created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

### Link from recognized rows

`competitor_shelf_items.processing_run_id` now has a nullable foreign key to `price_capture_runs(id)`.

Existing rows remain valid because `processing_run_id` is nullable and was added in PV-01-01.

### RLS

Two policies are added if missing:

- `price_capture_runs_member_select` for company members;
- `price_capture_runs_manager_write` for admin/manager.

### Indexes

```sql
idx_price_capture_runs_company_store_week
idx_price_capture_runs_company_status
idx_price_capture_runs_started_at
idx_price_capture_runs_photo_sha256
```

## What this enables

Future pipeline stages can record:

- how many photos were processed;
- how many price tags were detected;
- how many crops were generated;
- how many OCR attempts succeeded;
- how many prices were parsed;
- how many rows were auto-matched;
- how many rows went to review;
- how many rows remained unmatched;
- how many paid AI calls happened;
- estimated AI cost;
- average processing time and failure reasons.

## Safety

The migration is additive:

- creates a new table;
- adds a nullable FK from an existing nullable column;
- does not rewrite existing data;
- does not change app/server/UI/export/matching logic;
- does not apply anything to production.

## Not included in PV-01-02

- No crop generator.
- No detector adapter.
- No OCR adapter.
- No price parser.
- No review UI.
- No AI fallback policy.
- No production migration execution.
