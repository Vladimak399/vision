# PV-12-03 — First live controlled evidence test row runbook

Status: runbook only. This does not enable a production route.

## Goal

Insert exactly one controlled test evidence row into Supabase, verify that the schema/RLS/service-role path works, then clean that row up.

This is not the production price-capture flow.

## Required local env

Do not commit these values.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ncefnrodgzhwwxzogbur.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key, local/server only>

PRICEVISION_CONTROLLED_TEST_COMPANY_ID=<company uuid>
PRICEVISION_CONTROLLED_TEST_STORE_ID=<store uuid>
```

For dry-run, keep writes disabled:

```bash
PRICEVISION_EVIDENCE_PERSISTENCE_MODE=dry_run
PRICEVISION_EVIDENCE_PERSISTENCE_WRITE_CONFIRM=
PRICEVISION_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM=
```

For the one-row live insert only, all three guards must be set:

```bash
PRICEVISION_EVIDENCE_PERSISTENCE_MODE=write
PRICEVISION_EVIDENCE_PERSISTENCE_WRITE_CONFIRM=YES_I_UNDERSTAND_THIS_WRITES_EVIDENCE
PRICEVISION_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM=YES_I_UNDERSTAND_THIS_INSERTS_ONE_TEST_ROW
```

## Step 1 — readiness check

```bash
npm run check:evidence-readiness
```

Expected:

```txt
readyForDryRun: true
```

If `readyForControlledWrite` is false, inspect the JSON guard reason before going further.

## Step 2 — dry-run insert plan

```bash
npm run insert:evidence-test-row -- --marker first-live-check --week 1
```

Expected:

```txt
mode: dry_run
writeExecuted: false
payloads.priceCaptureRun
payloads.competitorShelfItem
cleanup
```

Save the emitted `marker` and `cleanup.runWhere.id` / run id.

## Step 3 — live insert, one row only

Run only after checking the payload and setting all three guard env values.

```bash
npm run insert:evidence-test-row -- --marker first-live-check --week 1 --execute
```

Expected:

```txt
mode: execute
writeExecuted: true
inserted.priceCaptureRunId: <uuid>
inserted.competitorShelfItemId: <uuid>
```

If `competitor_shelf_items` insert fails after `price_capture_runs` insert succeeds, run cleanup with the emitted marker/run id.

## Step 4 — cleanup dry-run

```bash
npm run cleanup:evidence-test-row -- \
  --marker PV_CONTROLLED_EVIDENCE_TEST_ROW_first-live-check \
  --run-id <run uuid>
```

Expected:

```txt
mode: dry_run
cleanupExecuted: false
instruction.tablesInOrder: competitor_shelf_items, price_capture_runs
```

## Step 5 — live cleanup

```bash
npm run cleanup:evidence-test-row -- \
  --marker PV_CONTROLLED_EVIDENCE_TEST_ROW_first-live-check \
  --run-id <run uuid> \
  --execute
```

Expected:

```txt
mode: execute
cleanupExecuted: true
```

## Safety constraints

1. The marker must start with `PV_CONTROLLED_EVIDENCE_TEST_ROW`.
2. Cleanup deletes from `competitor_shelf_items` first, then `price_capture_runs`.
3. The CLI is not called by any app route.
4. This test row must not be used in reporting or category-manager exports.
5. Do not reuse this as a production ingestion mechanism.

## After successful test

Keep production ingestion disabled until a reviewed admin-only route or worker path is added.
