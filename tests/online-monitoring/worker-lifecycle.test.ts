/**
 * Worker Lifecycle Runtime Test — TASK-32
 *
 * Запуск: `npx tsx --test tests/online-monitoring/worker-lifecycle.test.ts`
 * (требуется tsx; не входит в `npm run test`, т.к. там только offline node).
 *
 * Проверяет чистую логику классификации «застрявших» running run-ов и что
 * service-role boundary модуль не тянет HTTP-контекстный серверный клиент.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  classifyStaleRun,
  DEFAULT_RUN_LOCK_TIMEOUT_MS,
} from "../../server/online-monitoring/run-service-role";

const MIN = 60 * 1000;

test("classifyStaleRun: fresh run is left alone (ok)", () => {
  const now = Date.now();
  const startedAt = new Date(now - 2 * MIN).toISOString();
  assert.equal(classifyStaleRun(startedAt, now, DEFAULT_RUN_LOCK_TIMEOUT_MS), "ok");
});

test("classifyStaleRun: null startedAt is ok", () => {
  assert.equal(classifyStaleRun(null, Date.now(), DEFAULT_RUN_LOCK_TIMEOUT_MS), "ok");
});

test("classifyStaleRun: invalid startedAt is ok (no crash)", () => {
  assert.equal(
    classifyStaleRun("not-a-date", Date.now(), DEFAULT_RUN_LOCK_TIMEOUT_MS),
    "ok"
  );
});

test("classifyStaleRun: stuck beyond lock timeout -> requeue", () => {
  const now = Date.now();
  const startedAt = new Date(now - DEFAULT_RUN_LOCK_TIMEOUT_MS - 5 * MIN).toISOString();
  assert.equal(classifyStaleRun(startedAt, now, DEFAULT_RUN_LOCK_TIMEOUT_MS), "requeue");
});

test("classifyStaleRun: stuck beyond 2x lock timeout -> fail", () => {
  const now = Date.now();
  const startedAt = new Date(now - DEFAULT_RUN_LOCK_TIMEOUT_MS * 2 - 5 * MIN).toISOString();
  assert.equal(classifyStaleRun(startedAt, now, DEFAULT_RUN_LOCK_TIMEOUT_MS), "fail");
});

test("classifyStaleRun: boundary exactly at timeout -> requeue (>=)", () => {
  const now = Date.now();
  const startedAt = new Date(now - DEFAULT_RUN_LOCK_TIMEOUT_MS).toISOString();
  assert.equal(classifyStaleRun(startedAt, now, DEFAULT_RUN_LOCK_TIMEOUT_MS), "requeue");
});

test("classifyStaleRun: boundary at 2x timeout -> fail (>=)", () => {
  const now = Date.now();
  const startedAt = new Date(now - DEFAULT_RUN_LOCK_TIMEOUT_MS * 2).toISOString();
  assert.equal(classifyStaleRun(startedAt, now, DEFAULT_RUN_LOCK_TIMEOUT_MS), "fail");
});

test("classifyStaleRun: custom lock timeout respected", () => {
  const lock = 10 * MIN;
  const now = Date.now();
  const startedAt = new Date(now - 15 * MIN).toISOString();
  assert.equal(classifyStaleRun(startedAt, now, lock), "requeue");
  assert.equal(classifyStaleRun(startedAt, now, lock * 2 + 1), "ok");
});

test("run-service-role module does not import HTTP-context server client", () => {
  // Реально импортируем модуль (выше) и проверяем его исходник на отсутствие
  // createSupabaseServerClient / cookies() — гарантия TASK-31 границы.
  const here = dirname(fileURLToPath(import.meta.url));
  const modulePath = resolve(here, "../../server/online-monitoring/run-service-role.ts");
  // Убираем комментарии, чтобы документационные упоминания в комментариях
  // createSupabaseServerClient не давали ложных срабатываний.
  const raw = readFileSync(modulePath, "utf8");
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !src.includes("createSupabaseServerClient"),
    "run-service-role.ts must not reference createSupabaseServerClient"
  );
  assert.ok(
    !src.includes("next/headers") && !/\bcookies\s*\(/.test(src),
    "run-service-role.ts must not use cookies() from next/headers"
  );
  assert.ok(
    src.includes("createSupabaseServiceRoleClient"),
    "run-service-role.ts should use the service-role client"
  );
});
