import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { test } from "node:test";

const outDir = ".tmp/controlled-evidence-test-row-cli-test";

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync("npx", [
    "tsc",
    "scripts/controlled-evidence-test-row-insert.ts",
    "scripts/controlled-evidence-test-row-cleanup.ts",
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

const insertCli = await import(`../${outDir}/scripts/controlled-evidence-test-row-insert.js`);
const cleanupCli = await import(`../${outDir}/scripts/controlled-evidence-test-row-cleanup.js`);

test("insert CLI parses ids from env and marker from args", () => {
  const args = insertCli.parseInsertArgs(["--marker", "first-live-check", "--week", "2"], {
    PRICEVISION_CONTROLLED_TEST_COMPANY_ID: "11111111-1111-4111-8111-111111111111",
    PRICEVISION_CONTROLLED_TEST_STORE_ID: "22222222-2222-4222-8222-222222222222",
  });

  assert.equal(args.companyId, "11111111-1111-4111-8111-111111111111");
  assert.equal(args.storeId, "22222222-2222-4222-8222-222222222222");
  assert.equal(args.marker, "first-live-check");
  assert.equal(args.week, 2);
});

test("cleanup CLI parses marker and run id", () => {
  const args = cleanupCli.parseCleanupArgs([
    "--marker=PV_CONTROLLED_EVIDENCE_TEST_ROW_first",
    "--run-id",
    "33333333-3333-4333-8333-333333333333",
  ], {});

  assert.equal(args.marker, "PV_CONTROLLED_EVIDENCE_TEST_ROW_first");
  assert.equal(args.runId, "33333333-3333-4333-8333-333333333333");
});
