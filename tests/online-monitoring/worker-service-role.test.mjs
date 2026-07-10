/**
 * Worker Service-Role Boundary Smoke Test — TASK-31 / TASK-32 (B1, B6)
 *
 * Offline (`node --test`), без БД. Гарантирует, что автономный worker не тянет
 * HTTP-контекстный `createSupabaseServerClient()` / `cookies()` из
 * `next/headers` по цепочке импортов run-жизненного цикла.
 *
 * Проверяет:
 *  TASK-31 (B1):
 *   1. Worker больше НЕ импортирует `server/online-monitoring/run.ts`
 *      (оттуда тянулся createSupabaseServerClient + cookies()).
 *   2. Service-role boundary модули (`run-service-role.ts`, `claim-run.ts`)
 *      не содержат createSupabaseServerClient / cookies().
 *   3. Worker передаёт service-role `supabase` в alert-генераторы, поэтому
 *      дефолтный resolveClient() fallback (createSupabaseServerClient) не
 *      вызывается из worker-пути.
 *   4. Неиспользуемый `createRun` импорт удалён.
 *  TASK-32 (B6):
 *   5. Worker подписан на SIGTERM/SIGINT и вызывает recoverStaleRuns.
 *   6. В processRun есть идемпотентный guard: delete online_prices по run_id
 *      (retry без дублей цен).
 *   7. run-service-role.ts экспортирует classifyStaleRun + recoverStaleRuns.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
const WORKER = join(ROOT, "server/worker/online-monitoring-worker.ts");
const RUN_SERVICE_ROLE = join(ROOT, "server/online-monitoring/run-service-role.ts");
const CLAIM_RUN = join(ROOT, "server/online-monitoring/claim-run.ts");
const RUN_TS = join(ROOT, "server/online-monitoring/run.ts");

function read(p) {
  if (!existsSync(p)) throw new Error(`File not found: ${p}`);
  return readFileSync(p, "utf8");
}

// Убираем комментарии, чтобы документационные упоминания
// createSupabaseServerClient в комментариях не давали ложных срабатываний.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * Собрать транзитивный граф импортов (только локальные relative-импорты).
 */
function collectImportGraph(entryPath) {
  const visited = new Set();
  const queue = [entryPath];

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const src = read(current);
    const importRe = /(?:from|import)\s+["']([^"']+)["']/g;
    let m;
    while ((m = importRe.exec(src))) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // только локальные
      const base = resolve(dirname(current), spec);
      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
      ];
      const found = candidates.find((c) => existsSync(c));
      if (found) queue.push(found);
    }
  }
  return visited;
}

describe("TASK-31: worker service-role boundary", () => {
  it("worker does not import the HTTP-context run.ts module", () => {
    const graph = collectImportGraph(WORKER);
    assert.ok(
      !graph.has(RUN_TS),
      "Worker must not import server/online-monitoring/run.ts (uses createSupabaseServerClient + cookies())"
    );
  });

  it("service-role boundary modules never touch createSupabaseServerClient/cookies", () => {
    for (const file of [RUN_SERVICE_ROLE, CLAIM_RUN]) {
      const src = stripComments(read(file));
      assert.ok(
        !src.includes("createSupabaseServerClient"),
        `${file} must not reference createSupabaseServerClient()`
      );
      assert.ok(
        !src.includes("next/headers") && !/\bcookies\s*\(/.test(src),
        `${file} must not use cookies() from next/headers`
      );
    }
  });

  it("worker imports run data via service-role boundary (getRunForWorker + claimRun)", () => {
    const src = read(WORKER);
    assert.ok(
      src.includes('from "../online-monitoring/run-service-role"'),
      "Worker should import getRunForWorker from run-service-role.ts"
    );
    assert.ok(
      src.includes('from "../online-monitoring/claim-run"'),
      "Worker should import claimRun from claim-run.ts (service-role)"
    );
  });

  it("worker passes service-role supabase into alert generators (no server-client fallback)", () => {
    const src = read(WORKER);
    // Все три вызова alert-генераторов в worker должны получать `supabase`
    // (service-role клиент), иначе resolveClient() вызовет
    // createSupabaseServerClient() вне HTTP-контекста.
    for (const fn of [
      "generateRunAlerts(",
      "generatePriceChangeAlerts(",
      "generateOutOfStockAlert(",
    ]) {
      assert.ok(src.includes(fn), `Worker should call ${fn}`);
      // Последний аргумент вызова — `supabase` (service-role клиент), иначе
      // resolveClient() вызовет createSupabaseServerClient вне HTTP-контекста.
      // Вызов многострочный, поэтому ищем `, supabase )` с пробелами/переносами.
      const esc = fn.replace(/[()]/g, "\\$&");
      const re = new RegExp(`${esc}[\\s\\S]*?,\\s*supabase\\s*\\)`);
      assert.ok(
        re.test(src),
        `Worker must pass service-role supabase to ${fn} (got no ", supabase)" arg)`
      );
    }
  });

  it("unused createRun import removed from worker", () => {
    const src = read(WORKER);
    assert.ok(
      !/\bcreateRun\b/.test(src),
      "Worker must not import/use createRun (it is an HTTP-context helper)"
    );
  });
});

describe("TASK-32: worker lifecycle safety", () => {
  it("worker handles SIGTERM/SIGINT and recovers stale runs on startup", () => {
    const src = read(WORKER);
    assert.ok(src.includes("SIGTERM"), "Worker must subscribe to SIGTERM");
    assert.ok(src.includes("SIGINT"), "Worker must subscribe to SIGINT");
    assert.ok(
      src.includes("recoverStaleRuns()"),
      "Worker must call recoverStaleRuns() (stale 'running' recovery)"
    );
  });

  it("processRun has idempotent price dedupe guard (retry without duplicates)", () => {
    const src = read(WORKER);
    assert.ok(
      src.includes('from("online_prices").delete().eq("run_id"'),
      "processRun must delete existing online_prices for run_id before re-inserting (no-duplicate retry)"
    );
  });

  it("run-service-role exports classifyStaleRun + recoverStaleRuns", () => {
    const src = read(RUN_SERVICE_ROLE);
    assert.ok(
      src.includes("export function classifyStaleRun"),
      "run-service-role must export classifyStaleRun"
    );
    assert.ok(
      src.includes("export async function recoverStaleRuns"),
      "run-service-role must export recoverStaleRuns"
    );
  });
});
