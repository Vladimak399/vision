# PV-13-01 — Live controlled evidence test result

Date: 2026-07-10.

Scope: one controlled PriceVision evidence row test against the connected Supabase project `vision` (`ncefnrodgzhwwxzogbur`).

## Result

A controlled test row was inserted into the live Supabase database and then cleaned up.

Selected existing data used for the test:

```txt
company_id = 25d44227-b1db-4ae1-b550-86ff9ac5a368
store_id = 30b2d36e-83fb-4030-b353-3f9da43e6abe
store_name = Гусев
```

Test marker:

```txt
PV_CONTROLLED_EVIDENCE_TEST_ROW_CHATGPT_20260710_1355
```

Inserted ids returned by Supabase:

```txt
price_capture_runs.id = f8054bec-377b-428d-871e-357ebb086960
competitor_shelf_items.id = 2e0abe0c-7bac-491f-bccb-3f465b508b62
```

Post-cleanup verification:

```txt
price_capture_runs_count = 0
controlled_evidence_count = 0
```

## Important implementation note

Do not combine insert, verification select, and cleanup delete into one PostgreSQL data-modifying CTE statement for this test flow.

In the live test, the insert CTE returned ids successfully, but same-statement verification/delete CTEs did not see the freshly inserted rows through ordinary table scans. Cleanup was then performed with separate SQL statements in the correct order:

```txt
1. delete from competitor_shelf_items by controlled review_reason/marker
2. delete from price_capture_runs by controlled marker filename
3. verify counts are zero
```

The application executor modules are already safer than the ad-hoc SQL experiment because they run insert and cleanup as separate client calls.

## Current status

The database was left clean after the controlled test:

```txt
public.price_capture_runs: 0 rows
public.competitor_shelf_items rows with review_reason = controlled_test_row_do_not_use_for_reports: 0 rows
```

No production route or UI uses evidence writes yet.
