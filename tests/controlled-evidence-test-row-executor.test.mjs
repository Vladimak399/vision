import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { test } from "node:test";

const outDir = ".tmp/controlled-evidence-test-row-executor-test";
const VALID_COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const VALID_STORE_ID = "22222222-2222-4222-8222-222222222222";
const VALID_RUN_ID = "33333333-3333-4333-8333-333333333333";
const MARKER = "PV_CONTROLLED_EVIDENCE_TEST_ROW_EXECUTOR";

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync("npx", [
    "tsc",
    "server/price-capture/crop-generator.ts",
    "server/price-capture/evidence-contract.ts",
    "server/price-capture/evidence-persistence.ts",
    "server/price-capture/local-pipeline.ts",
    "server/price-capture/supabase-evidence-repository.ts",
    "server/price-capture/controlled-evidence-test-row.ts",
    "server/price-capture/controlled-evidence-test-row-executor.ts",
    "server/price-capture/controlled-evidence-test-row-cleanup.ts",
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--esModuleInterop",
    "--skipLibCheck",
  ], { stdio: "inherit" });
}

compile();

const executor = await import(`../${outDir}/controlled-evidence-test-row-executor.js`);
const cleanup = await import(`../${outDir}/controlled-evidence-test-row-cleanup.js`);
const repository = await import(`../${outDir}/supabase-evidence-repository.js`);

function createInsertClient() {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push({ op: "from", table });
        return {
          insert(payload) {
            calls.push({ op: "insert", table, payload });
            return {
              select(columns) {
                calls.push({ op: "select", table, columns });
                return {
                  async single() {
                    calls.push({ op: "single", table });
                    return { data: { id: table === "price_capture_runs" ? "run-row" : "evidence-row" }, error: null };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

function createCleanupClient() {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push({ op: "from", table });
        return {
          delete() {
            calls.push({ op: "delete", table });
            const query = {
              eq(column, value) {
                calls.push({ op: "eq", table, column, value });
                return query;
              },
              like(column, value) {
                calls.push({ op: "like", table, column, value });
                return query;
              },
              async select(columns) {
                calls.push({ op: "select", table, columns });
                return { data: [{ id: `${table}-deleted` }], error: null };
              },
            };
            return query;
          },
        };
      },
    },
  };
}

function planInput() {
  return {
    companyId: VALID_COMPANY_ID,
    storeId: VALID_STORE_ID,
    runId: VALID_RUN_ID,
    marker: MARKER,
    nowIso: "2026-07-10T10:00:00.000Z",
  };
}

function writeEnv() {
  return {
    [repository.SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
    [repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
    [repository.SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE,
  };
}

test("controlled test row executor is dry-run by default and does not call client", async () => {
  const fake = createInsertClient();

  const result = await executor.executeControlledEvidenceTestRow(planInput(), {
    client: fake.client,
    env: writeEnv(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry_run");
  assert.equal(result.writeExecuted, false);
  assert.deepEqual(fake.calls, []);
});

test("controlled test row executor blocks execute when write guard is missing", async () => {
  const fake = createInsertClient();

  const result = await executor.executeControlledEvidenceTestRow(planInput(), {
    client: fake.client,
    env: {},
    execute: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.mode, "execute");
  assert.equal(result.writeExecuted, false);
  assert.equal(result.guard.writeEnabled, false);
  assert.deepEqual(fake.calls, []);
});

test("controlled test row executor inserts run before evidence when explicitly enabled", async () => {
  const fake = createInsertClient();

  const result = await executor.executeControlledEvidenceTestRow(planInput(), {
    client: fake.client,
    env: writeEnv(),
    execute: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.writeExecuted, true);
  assert.equal(result.inserted.priceCaptureRunId, "run-row");
  assert.equal(result.inserted.competitorShelfItemId, "evidence-row");
  assert.deepEqual(
    fake.calls.filter((call) => call.op === "insert").map((call) => call.table),
    ["price_capture_runs", "competitor_shelf_items"],
  );
  assert.equal(fake.calls.find((call) => call.table === "competitor_shelf_items" && call.op === "insert").payload.processing_run_id, VALID_RUN_ID);
});

test("controlled test row cleanup is dry-run by default and does not call client", async () => {
  const fake = createCleanupClient();

  const result = await cleanup.cleanupControlledEvidenceTestRow({ marker: MARKER, runId: VALID_RUN_ID }, {
    client: fake.client,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry_run");
  assert.equal(result.cleanupExecuted, false);
  assert.deepEqual(fake.calls, []);
});

test("controlled test row cleanup removes evidence before run when explicitly enabled", async () => {
  const fake = createCleanupClient();

  const result = await cleanup.cleanupControlledEvidenceTestRow({ marker: MARKER, runId: VALID_RUN_ID }, {
    client: fake.client,
    execute: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.cleanupExecuted, true);
  assert.deepEqual(
    fake.calls.filter((call) => call.op === "delete").map((call) => call.table),
    ["competitor_shelf_items", "price_capture_runs"],
  );
  assert.ok(fake.calls.some((call) => call.op === "like" && call.column === "raw_name" && call.value === `${MARKER}%`));
  assert.ok(fake.calls.some((call) => call.op === "eq" && call.column === "id" && call.value === VALID_RUN_ID));
});

test("controlled test row cleanup rejects unsafe marker", async () => {
  const fake = createCleanupClient();

  await assert.rejects(
    () => cleanup.cleanupControlledEvidenceTestRow({ marker: "manual", runId: VALID_RUN_ID }, { client: fake.client, execute: true }),
    /marker must start/,
  );
  assert.deepEqual(fake.calls, []);
});
