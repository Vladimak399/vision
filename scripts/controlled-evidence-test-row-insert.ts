import { buildControlledEvidenceTestRowPlan, type ControlledEvidenceTestRowPlanInput } from "../server/price-capture/controlled-evidence-test-row";
import { executeControlledEvidenceTestRow, type ControlledEvidenceTestRowClient } from "../server/price-capture/controlled-evidence-test-row-executor";
import { createSupabaseEvidenceClientFromEnv } from "../server/price-capture/supabase-evidence-client-factory";
import {
  SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV,
  SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE,
  SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV,
  SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
  SUPABASE_EVIDENCE_WRITE_MODE_ENV,
} from "../server/price-capture/supabase-evidence-repository";

export const TEST_COMPANY_ID_ENV = "PRICEVISION_CONTROLLED_TEST_COMPANY_ID" as const;
export const TEST_STORE_ID_ENV = "PRICEVISION_CONTROLLED_TEST_STORE_ID" as const;

type InsertCliArgs = ControlledEvidenceTestRowPlanInput & {
  execute: boolean;
};

async function main() {
  const args = parseInsertArgs(process.argv.slice(2), process.env);

  if (!args.companyId || !args.storeId) {
    printJson({
      ok: false,
      error: "missing_company_or_store_id",
      required: [
        `${TEST_COMPANY_ID_ENV}=<uuid>`,
        `${TEST_STORE_ID_ENV}=<uuid>`,
      ],
      mode: args.execute ? "execute" : "dry_run",
    });
    process.exitCode = 1;
    return;
  }

  if (!args.execute) {
    const plan = buildControlledEvidenceTestRowPlan(args);
    printJson({
      ok: true,
      mode: "dry_run",
      writeExecuted: false,
      marker: plan.marker,
      warnings: plan.warnings,
      requiredForExecute: buildRequiredExecuteEnv(),
      payloads: {
        priceCaptureRun: plan.priceCaptureRunPayload,
        competitorShelfItem: plan.evidencePayload,
      },
      cleanup: plan.cleanup,
    });
    return;
  }

  const clientResult = createSupabaseEvidenceClientFromEnv({ useServiceRole: true });
  if (!clientResult.ok) {
    printJson({
      ok: false,
      mode: "execute",
      writeExecuted: false,
      error: clientResult.error,
      diagnostics: clientResult.diagnostics,
    });
    process.exitCode = 1;
    return;
  }

  const result = await executeControlledEvidenceTestRow(args, {
    client: clientResult.client as unknown as ControlledEvidenceTestRowClient,
    env: process.env,
    execute: true,
  });

  printJson({
    ok: result.ok,
    mode: result.mode,
    writeExecuted: result.writeExecuted,
    marker: result.plan.marker,
    inserted: result.inserted,
    guard: result.guard,
    error: result.error,
    cleanup: result.plan.cleanup,
  });

  if (!result.ok) process.exitCode = 1;
}

export function parseInsertArgs(argv: string[], env: Record<string, string | undefined> = process.env): InsertCliArgs {
  const args: InsertCliArgs = {
    companyId: env[TEST_COMPANY_ID_ENV] ?? "",
    storeId: env[TEST_STORE_ID_ENV] ?? "",
    execute: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute") {
      args.execute = true;
      continue;
    }

    const { flag, value, consumedNext } = readFlagValue(token, argv[index + 1]);
    if (consumedNext) index += 1;

    if (flag === "--company-id") args.companyId = value;
    else if (flag === "--store-id") args.storeId = value;
    else if (flag === "--week") args.week = value === "2" ? 2 : 1;
    else if (flag === "--run-id") args.runId = value;
    else if (flag === "--marker") args.marker = value;
    else if (flag === "--now") args.nowIso = value;
    else if (flag === "--captured-date") args.capturedDate = value;
  }

  return args;
}

function readFlagValue(token: string, nextToken: string | undefined): { flag: string; value: string; consumedNext: boolean } {
  const [flag, inlineValue] = token.split("=", 2);
  if (typeof inlineValue === "string") return { flag, value: inlineValue, consumedNext: false };
  if (flag.startsWith("--")) return { flag, value: nextToken ?? "", consumedNext: true };
  return { flag, value: "", consumedNext: false };
}

function buildRequiredExecuteEnv(): Record<string, string> {
  return {
    [SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
    [SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]: SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
    [SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV]: SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE,
  };
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
