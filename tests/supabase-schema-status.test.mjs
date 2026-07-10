import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiledDir = resolve(rootDir, ".test-build", "supabase-schema-status");
const tsconfigPath = resolve(compiledDir, "tsconfig.json");

async function compileModule() {
  await mkdir(compiledDir, { recursive: true });
  await writeFile(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: ".",
      rootDir: "../..",
      noEmitOnError: true,
    },
    include: ["../../server/price-capture/supabase-schema-status.ts"],
  }, null, 2));
  await execFileAsync("npx", ["tsc", "-p", tsconfigPath], { cwd: rootDir });
  return import("../.test-build/supabase-schema-status/server/price-capture/supabase-schema-status.js");
}

describe("supabase schema status", () => {
  it("flags the observed production-like competitor_shelf_items schema as migration_required", async () => {
    const { buildPriceVisionSupabaseSchemaStatus } = await compileModule();
    const status = buildPriceVisionSupabaseSchemaStatus({
      competitorShelfItems: table("public.competitor_shelf_items", [
        "id",
        "company_id",
        "week",
        "store_id",
        "raw_name",
        "brand",
        "size_text",
        "price_minor",
        "old_price_minor",
        "promo_price_minor",
        "currency",
        "price_tag_text",
        "product_visible_text",
        "confidence",
        "photo_storage_path",
        "captured_date",
        "created_at",
        "catalog_product_id",
        "match_confidence",
        "match_reason",
        "matched_at",
        "updated_at",
        "photo_filename",
      ]),
      priceCaptureRuns: null,
      securityAdvisories: [],
    });

    assert.equal(status.status, "migration_required");
    assert.equal(status.competitorShelfItems.exists, true);
    assert.ok(status.competitorShelfItems.missingColumnNames.includes("bbox"));
    assert.ok(status.competitorShelfItems.missingColumnNames.includes("processing_run_id"));
    assert.equal(status.priceCaptureRuns.exists, false);
    assert.ok(status.blockers.some((blocker) => blocker.includes("price_capture_runs")));
  });

  it("returns ready when evidence columns and price_capture_runs are present", async () => {
    const {
      EXPECTED_COMPETITOR_SHELF_ITEM_EVIDENCE_COLUMNS,
      EXPECTED_PRICE_CAPTURE_RUNS_COLUMNS,
      buildPriceVisionSupabaseSchemaStatus,
    } = await compileModule();

    const status = buildPriceVisionSupabaseSchemaStatus({
      competitorShelfItems: table("public.competitor_shelf_items", EXPECTED_COMPETITOR_SHELF_ITEM_EVIDENCE_COLUMNS.map((column) => column.name)),
      priceCaptureRuns: table("public.price_capture_runs", EXPECTED_PRICE_CAPTURE_RUNS_COLUMNS.map((column) => column.name)),
      securityAdvisories: [],
    });

    assert.equal(status.status, "ready");
    assert.deepEqual(status.blockers, []);
    assert.deepEqual(status.competitorShelfItems.missingColumnNames, []);
    assert.deepEqual(status.priceCaptureRuns.missingColumnNames, []);
  });

  it("surfaces unresolved exposed-schema security advisories as blockers", async () => {
    const {
      EXPECTED_COMPETITOR_SHELF_ITEM_EVIDENCE_COLUMNS,
      EXPECTED_PRICE_CAPTURE_RUNS_COLUMNS,
      buildPriceVisionSupabaseSchemaStatus,
    } = await compileModule();

    const status = buildPriceVisionSupabaseSchemaStatus({
      competitorShelfItems: table("public.competitor_shelf_items", EXPECTED_COMPETITOR_SHELF_ITEM_EVIDENCE_COLUMNS.map((column) => column.name)),
      priceCaptureRuns: table("public.price_capture_runs", EXPECTED_PRICE_CAPTURE_RUNS_COLUMNS.map((column) => column.name)),
      securityAdvisories: [{
        name: "rls_disabled_in_public",
        level: "ERROR",
        title: "RLS Disabled in Public",
        metadata: { schema: "public", name: "golden_dataset_samples", type: "table" },
      }],
    });

    assert.equal(status.status, "migration_required");
    assert.ok(status.securityFindings[0].includes("golden_dataset_samples"));
    assert.ok(status.blockers.some((blocker) => blocker.includes("security advisors")));
  });
});

function table(name, columnNames) {
  return {
    name,
    rls_enabled: true,
    columns: columnNames.map((columnName) => ({ name: columnName })),
    foreign_key_constraints: [],
  };
}
