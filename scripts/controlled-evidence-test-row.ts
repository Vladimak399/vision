import { buildControlledEvidenceTestRowPlan } from "../server/price-capture/controlled-evidence-test-row";
import {
  SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV,
  SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE,
  SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV,
  SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
  SUPABASE_EVIDENCE_WRITE_MODE_ENV,
} from "../server/price-capture/supabase-evidence-repository";

const TEST_COMPANY_ID_ENV = "PRICEVISION_CONTROLLED_TEST_COMPANY_ID";
const TEST_STORE_ID_ENV = "PRICEVISION_CONTROLLED_TEST_STORE_ID";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const companyId = args.companyId ?? process.env[TEST_COMPANY_ID_ENV] ?? null;
  const storeId = args.storeId ?? process.env[TEST_STORE_ID_ENV] ?? null;

  if (!companyId || !storeId) {
    printJson({
      ok: false,
      error: "missing_company_or_store_id",
      required: [
        `${TEST_COMPANY_ID_ENV}=<uuid>` ,
        `${TEST_STORE_ID_ENV}=<uuid>` ,
      ],
      note: "This script is dry-run only and does not insert rows.",
    });
    process.exitCode = 1;
    return;
  }

  const plan = buildControlledEvidenceTestRowPlan({
    companyId,
    storeId,
    week: args.week,
    runId: args.runId,
    marker: args.marker,
    nowIso: args.nowIso,
    capturedDate: args.capturedDate,
  });

  printJson({
    ok: true,
    mode: "dry_run_only",
    writeExecuted: false,
    marker: plan.marker,
    warnings: plan.warnings,
    guardRequiredForFutureControlledInsert: {
      [SUPABASE_EVIDENCE_WRITE_MODE_ENV]: "write",
      [SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]: SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE,
      [SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV]: SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE,
    },
    payloads: {
      priceCaptureRun: plan.priceCaptureRunPayload,
      competitorShelfItem: plan.evidencePayload,
    },
    cleanup: plan.cleanup,
  });
}

type Args = {
  companyId?: string | null;
  storeId?: string | null;
  week?: 1 | 2 | null;
  runId?: string | null;
  marker?: string | null;
  nowIso?: string | null;
  capturedDate?: string | null;
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const [flag, inlineValue] = token.split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (!inlineValue && flag.startsWith("--")) index += 1;

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

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main();
