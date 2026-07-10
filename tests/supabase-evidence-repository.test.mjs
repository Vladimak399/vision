import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tmpDir = join(process.cwd(), ".tmp", "supabase-evidence-repository-test");
const modulePath = join(tmpDir, "server", "price-capture", "supabase-evidence-repository.js");
const evidenceContractPath = join(tmpDir, "server", "price-capture", "evidence-contract.js");
const cropGeneratorPath = join(tmpDir, "server", "price-capture", "crop-generator.js");

async function compileModules() {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await execFileAsync("npx", [
    "tsc",
    "server/price-capture/crop-generator.ts",
    "server/price-capture/evidence-contract.ts",
    "server/price-capture/evidence-persistence.ts",
    "server/price-capture/local-pipeline.ts",
    "server/price-capture/supabase-evidence-repository.ts",
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
    repository: await import(pathToFileURL(modulePath).href),
    evidenceContract: await import(pathToFileURL(evidenceContractPath).href),
    cropGenerator: await import(pathToFileURL(cropGeneratorPath).href),
  };
}

function createRun() {
  return {
    companyId: "company-1",
    storeId: "store-1",
    week: 1,
    runId: "run-1",
    capturedDate: "2026-07-10",
    photoStoragePath: "photos/source.jpg",
    photoFilename: "source.jpg",
  };
}

function createDraft(buildCompetitorShelfItemEvidenceDraft) {
  const draft = buildCompetitorShelfItemEvidenceDraft({
    run: createRun(),
    image: { width: 200, height: 100 },
    detector: {
      itemId: "item-1",
      bbox: { x: 10, y: 20, width: 80, height: 30 },
      provider: "local",
      model: "heuristic-price-tag-v1",
      confidence: 0.91,
    },
    crop: {
      cropStoragePath: "evidence/company-1/runs/run-1/crops/item-1.jpg",
      cropPlan: {
        bbox: { x: 8, y: 18, width: 84, height: 34 },
        cropWidth: 84,
        cropHeight: 34,
        paddingPx: 2,
        wasClamped: false,
      },
    },
    ocr: {
      provider: "rapidocr-worker",
      model: "rapidocr-v3",
      text: "Кофе Жокей Традиционный 250 г 99,90",
      confidence: 0.82,
    },
    parsedPrice: {
      priceMinor: 9990,
      oldPriceMinor: null,
      promoPriceMinor: null,
      currency: "RUB",
      confidence: 0.9,
    },
    productText: {
      rawName: "Кофе Жокей Традиционный 250 г",
      normalizedProductText: "кофе жокей традиционный 250 г",
      brand: "Жокей",
      sizeText: "250 г",
      priceTagText: "Кофе Жокей Традиционный 250 г 99,90",
      productVisibleText: "Кофе Жокей Традиционный 250 г",
    },
  });

  assert.ok(draft);
  return draft;
}

function createMatch() {
  return {
    candidates: [],
    selectedCatalogProductId: "catalog-1",
    matchConfidence: 0.93,
    matchReason: "exact_name",
    reviewRequired: false,
  };
}

function createWriteEnv(repository) {
  return {
    [repository.SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
    [repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
    [repository.SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE,
  };
}

function createFakeClient(response = { data: { id: "row-1" }, error: null }) {
  const calls = {
    from: [],
    insert: [],
    select: [],
    single: 0,
  };

  return {
    calls,
    client: {
      from(table) {
        calls.from.push(table);
        return {
          insert(payload) {
            calls.insert.push(payload);
            return {
              select(columns) {
                calls.select.push(columns);
                return {
                  async single() {
                    calls.single += 1;
                    return response;
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

test("resolveSupabaseEvidenceWriteGuard keeps writes disabled by default", async () => {
  const { repository } = await loadModules();
  const guard = repository.resolveSupabaseEvidenceWriteGuard({});

  assert.equal(guard.writeEnabled, false);
  assert.equal(guard.reason, "mode_not_write");
  assert.equal(guard.confirmationPresent, false);
  assert.equal(guard.controlledTestRowConfirmationPresent, false);
});

test("resolveSupabaseEvidenceWriteGuard requires explicit confirmation after write mode", async () => {
  const { repository } = await loadModules();
  const guard = repository.resolveSupabaseEvidenceWriteGuard({
    [repository.SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
  });

  assert.equal(guard.writeEnabled, false);
  assert.equal(guard.reason, "missing_write_confirmation");
});

test("resolveSupabaseEvidenceWriteGuard requires controlled test row confirmation after write confirmation", async () => {
  const { repository } = await loadModules();
  const guard = repository.resolveSupabaseEvidenceWriteGuard({
    [repository.SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
    [repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
  });

  assert.equal(guard.writeEnabled, false);
  assert.equal(guard.reason, "missing_controlled_test_row_confirmation");
  assert.equal(guard.confirmationPresent, true);
  assert.equal(guard.controlledTestRowConfirmationPresent, false);
});

test("resolveSupabaseEvidenceWriteGuard enables writes only with all three env values", async () => {
  const { repository } = await loadModules();
  const guard = repository.resolveSupabaseEvidenceWriteGuard(createWriteEnv(repository));

  assert.equal(guard.writeEnabled, true);
  assert.equal(guard.reason, "write_enabled");
  assert.equal(guard.controlledTestRowConfirmationPresent, true);
});

test("SupabaseEvidenceRepository does not call client when guard is disabled", async () => {
  const { repository, evidenceContract } = await loadModules();
  const fake = createFakeClient();
  const writer = repository.createSupabaseEvidenceRepository({ client: fake.client, env: {} });
  const draft = createDraft(evidenceContract.buildCompetitorShelfItemEvidenceDraft);

  const result = await writer.write({ run: createRun(), draft, match: createMatch() });

  assert.equal(result.writeEnabled, false);
  assert.equal(result.rowId, null);
  assert.equal(result.guard.reason, "mode_not_write");
  assert.deepEqual(fake.calls.from, []);
  assert.deepEqual(fake.calls.insert, []);
});

test("SupabaseEvidenceRepository stays disabled when controlled test row guard is missing", async () => {
  const { repository, evidenceContract } = await loadModules();
  const fake = createFakeClient({ data: { id: "row-123" }, error: null });
  const writer = repository.createSupabaseEvidenceRepository({
    client: fake.client,
    env: {
      [repository.SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
      [repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]: repository.SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
    },
  });
  const draft = createDraft(evidenceContract.buildCompetitorShelfItemEvidenceDraft);

  const result = await writer.write({ run: createRun(), draft, match: createMatch() });

  assert.equal(result.writeEnabled, false);
  assert.equal(result.rowId, null);
  assert.equal(result.guard.reason, "missing_controlled_test_row_confirmation");
  assert.deepEqual(fake.calls.from, []);
  assert.deepEqual(fake.calls.insert, []);
});

test("SupabaseEvidenceRepository inserts through injected client when all guards are enabled", async () => {
  const { repository, evidenceContract } = await loadModules();
  const fake = createFakeClient({ data: { id: "row-123" }, error: null });
  const writer = repository.createSupabaseEvidenceRepository({
    client: fake.client,
    env: createWriteEnv(repository),
    matchedAt: "2026-07-10T12:00:00.000Z",
  });
  const draft = createDraft(evidenceContract.buildCompetitorShelfItemEvidenceDraft);

  const result = await writer.write({ run: createRun(), draft, match: createMatch() });

  assert.equal(result.writeEnabled, true);
  assert.equal(result.rowId, "row-123");
  assert.deepEqual(fake.calls.from, ["competitor_shelf_items"]);
  assert.equal(fake.calls.insert.length, 1);
  assert.equal(fake.calls.insert[0].catalog_product_id, "catalog-1");
  assert.equal(fake.calls.insert[0].matched_at, "2026-07-10T12:00:00.000Z");
  assert.deepEqual(fake.calls.select, ["id"]);
  assert.equal(fake.calls.single, 1);
});

test("SupabaseEvidenceRepository surfaces injected client errors", async () => {
  const { repository, evidenceContract } = await loadModules();
  const fake = createFakeClient({ data: null, error: { message: "insert blocked" } });
  const writer = repository.createSupabaseEvidenceRepository({
    client: fake.client,
    env: createWriteEnv(repository),
  });
  const draft = createDraft(evidenceContract.buildCompetitorShelfItemEvidenceDraft);

  await assert.rejects(
    () => writer.write({ run: createRun(), draft, match: createMatch() }),
    /insert blocked/,
  );
});
