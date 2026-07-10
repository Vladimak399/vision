import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tmpDir = join(process.cwd(), ".tmp", "supabase-live-readiness-test");
const readinessPath = join(tmpDir, "server", "price-capture", "supabase-live-readiness.js");
const repositoryPath = join(tmpDir, "server", "price-capture", "supabase-evidence-repository.js");

async function compileModules() {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await execFileAsync("npx", [
    "tsc",
    "server/price-capture/supabase-schema-status.ts",
    "server/price-capture/evidence-persistence.ts",
    "server/price-capture/local-pipeline.ts",
    "server/price-capture/evidence-contract.ts",
    "server/price-capture/crop-generator.ts",
    "server/price-capture/supabase-evidence-repository.ts",
    "server/price-capture/supabase-live-readiness.ts",
    "--outDir",
    tmpDir,
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--skipLibCheck",
  ]);
}

async function loadModules() {
  await compileModules();
  return {
    readiness: await import(pathToFileURL(readinessPath).href),
    repository: await import(pathToFileURL(repositoryPath).href),
  };
}

function createFakeReadinessClient(errorsByTable = {}) {
  const calls = [];

  return {
    calls,
    client: {
      from(table) {
        return {
          select(columns, options) {
            calls.push({ table, columns, options });
            return {
              async limit(count) {
                return {
                  data: null,
                  error: errorsByTable[table] ?? null,
                  count,
                };
              },
            };
          },
        };
      },
    },
  };
}

test("checkLiveSupabaseEvidenceSchema returns ready when table probes succeed", async () => {
  const { readiness } = await loadModules();
  const fake = createFakeReadinessClient();

  const report = await readiness.checkLiveSupabaseEvidenceSchema(fake.client);

  assert.equal(report.status, "ready");
  assert.equal(report.blockers.length, 0);
  assert.equal(report.checks.length, 2);
  assert.deepEqual(fake.calls.map((call) => call.table), [
    "competitor_shelf_items",
    "price_capture_runs",
  ]);
  assert.ok(fake.calls[0].columns.includes("bbox"));
  assert.ok(fake.calls[0].columns.includes("ocr_text"));
  assert.ok(fake.calls[1].columns.includes("duration_ms"));
});

test("checkLiveSupabaseEvidenceSchema reports migration_required when a probe fails", async () => {
  const { readiness } = await loadModules();
  const fake = createFakeReadinessClient({
    competitor_shelf_items: { message: "column ocr_text does not exist" },
  });

  const report = await readiness.checkLiveSupabaseEvidenceSchema(fake.client);

  assert.equal(report.status, "migration_required");
  assert.equal(report.blockers.length, 1);
  assert.match(report.blockers[0], /ocr_text/);
  assert.equal(report.checks[0].ok, false);
  assert.equal(report.checks[1].ok, true);
});

test("buildSupabaseEvidenceWriteReadinessReport blocks insert until controlled test row guard", async () => {
  const { readiness, repository } = await loadModules();
  const schema = {
    status: "ready",
    checks: [],
    blockers: [],
  };

  const blocked = readiness.buildSupabaseEvidenceWriteReadinessReport({
    schema,
    env: {
      [repository.SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
      [repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
    },
  });

  assert.equal(blocked.canAttemptControlledTestInsert, false);
  assert.equal(blocked.guard.reason, "missing_controlled_test_row_confirmation");

  const allowed = readiness.buildSupabaseEvidenceWriteReadinessReport({
    schema,
    env: {
      [repository.SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
      [repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
      [repository.SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE,
    },
  });

  assert.equal(allowed.canAttemptControlledTestInsert, true);
  assert.equal(allowed.guard.reason, "write_enabled");
});
