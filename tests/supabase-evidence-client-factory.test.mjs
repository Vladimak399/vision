import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { test } from "node:test";

const outDir = ".tmp/supabase-evidence-client-factory-test";

function compile() {
  mkdirSync(outDir, { recursive: true });
  execFileSync("npx", [
    "tsc",
    "server/price-capture/supabase-evidence-repository.ts",
    "server/price-capture/supabase-evidence-client-factory.ts",
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

const factory = await import(`../${outDir}/supabase-evidence-client-factory.js`);

const VALID_URL = "https://ncefnrodgzhwwxzogbur.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_test_key";
const SERVICE_ROLE_KEY = "service_role_test_key";

test("returns missing URL error", () => {
  const result = factory.createSupabaseEvidenceClientFromEnv({ env: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "missing_supabase_url");
  assert.equal(result.diagnostics.hasUrl, false);
});

test("rejects invalid URL", () => {
  const result = factory.createSupabaseEvidenceClientFromEnv({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://not-https.local",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_supabase_url");
});

test("rejects wrong Supabase project URL", () => {
  const result = factory.createSupabaseEvidenceClientFromEnv({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "wrong_project_url");
});

test("requires publishable key for non-service-role client", () => {
  const result = factory.createSupabaseEvidenceClientFromEnv({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: VALID_URL,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "missing_publishable_key");
});

test("builds publishable client boundary", () => {
  const result = factory.createSupabaseEvidenceClientFromEnv({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: VALID_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(typeof result.client.from, "function");
  assert.equal(result.diagnostics.useServiceRole, false);
  assert.equal(result.diagnostics.hasPublishableKey, true);
  assert.equal(result.diagnostics.hasServiceRoleKey, false);
});

test("requires service role key when service-role mode is requested", () => {
  const result = factory.createSupabaseEvidenceClientFromEnv({
    useServiceRole: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: VALID_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "missing_service_role_key");
});

test("builds service-role client boundary", () => {
  const result = factory.createSupabaseEvidenceClientFromEnv({
    useServiceRole: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: VALID_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(typeof result.client.from, "function");
  assert.equal(result.diagnostics.useServiceRole, true);
  assert.equal(result.diagnostics.hasServiceRoleKey, true);
});

test("returns env checklist without exposing actual keys", () => {
  const checklist = factory.buildSupabaseEvidenceClientEnvChecklist();

  assert.ok(checklist.some((line) => line.includes("NEXT_PUBLIC_SUPABASE_URL=")));
  assert.ok(checklist.some((line) => line.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<paste")));
  assert.ok(checklist.some((line) => line.includes("SUPABASE_SERVICE_ROLE_KEY=<paste")));
  assert.ok(checklist.some((line) => line.includes("PRICEVISION_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM=<leave unset")));
  assert.ok(checklist.every((line) => !line.includes("eyJhbGci")));
});
