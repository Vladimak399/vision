# PV-11-06 — Controlled evidence test row audit checklist

Status: implementation boundary and audit checklist. Do not run controlled evidence writes from production routes.

## Purpose

The controlled evidence test row is a one-row database smoke test for the new `price_capture_runs` and `competitor_shelf_items` evidence schema. It is not part of the normal photo processing flow and must not feed reports or analytics.

The test uses an obvious marker prefix:

```txt
PV_CONTROLLED_EVIDENCE_TEST_ROW
```

## Current safe commands

Plan the payloads only:

```bash
PRICEVISION_CONTROLLED_TEST_COMPANY_ID=<company uuid> \
PRICEVISION_CONTROLLED_TEST_STORE_ID=<store uuid> \
npm run plan:evidence-test-row -- --marker first-check --week 1
```

Check schema readiness only:

```bash
npm run check:evidence-readiness
```

Neither command inserts, updates, or deletes rows.

## Executor boundary

The repository now has an injected-client executor module:

```txt
server/price-capture/controlled-evidence-test-row-executor.ts
```

It is intentionally not exposed as an npm script. A caller must pass `execute: true` and a Supabase client explicitly.

The executor inserts in this order:

```txt
price_capture_runs
competitor_shelf_items
```

This order is required because `competitor_shelf_items.processing_run_id` references `price_capture_runs.id`.

## Required env guards before any controlled insert

All three guards must be present before the repository write guard allows a controlled write:

```bash
PRICEVISION_EVIDENCE_PERSISTENCE_MODE=write
PRICEVISION_EVIDENCE_PERSISTENCE_WRITE_CONFIRM=YES_I_UNDERSTAND_THIS_WRITES_EVIDENCE
PRICEVISION_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM=YES_I_UNDERSTAND_THIS_INSERTS_ONE_TEST_ROW
```

For local/server-only Supabase access, also set:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ncefnrodgzhwwxzogbur.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
```

Do not commit keys.

## Cleanup boundary

The cleanup module is:

```txt
server/price-capture/controlled-evidence-test-row-cleanup.ts
```

It is also intentionally not exposed as an npm script. It requires a marker starting with `PV_CONTROLLED_EVIDENCE_TEST_ROW` and a run UUID.

Cleanup order:

```txt
competitor_shelf_items
price_capture_runs
```

The evidence row is filtered by:

```txt
processing_run_id = <run id>
raw_name LIKE '<marker>%'
```

The run row is filtered by:

```txt
id = <run id>
photo_filename = '<marker>.jpg'
```

## Before enabling any real route

Do not wire this into a production API route until all are true:

1. `npm run check:evidence-readiness` passes locally with the intended Supabase env.
2. One controlled test row has been inserted and then cleaned up.
3. Storage policies for source photos and crop evidence are verified.
4. Review queue behavior for `review_status='pending'` is specified.
5. The code path is admin-only or service-only, never public.
6. Normal writes remain behind feature flags and explicit env guards.

## Non-goals

This PR does not add:

```txt
production route writes
bulk insert
photo upload
crop upload
UI review queue
Vercel deploy behavior
```
