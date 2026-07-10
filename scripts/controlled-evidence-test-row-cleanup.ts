import { buildControlledEvidenceTestRowCleanupInstruction } from "../server/price-capture/controlled-evidence-test-row";
import { cleanupControlledEvidenceTestRow, type ControlledEvidenceTestRowCleanupClient } from "../server/price-capture/controlled-evidence-test-row-cleanup";
import { createSupabaseEvidenceClientFromEnv } from "../server/price-capture/supabase-evidence-client-factory";

export const TEST_MARKER_ENV = "PRICEVISION_CONTROLLED_TEST_MARKER" as const;
export const TEST_RUN_ID_ENV = "PRICEVISION_CONTROLLED_TEST_RUN_ID" as const;

type CleanupCliArgs = {
  marker: string;
  runId: string;
  execute: boolean;
};

async function main() {
  const args = parseCleanupArgs(process.argv.slice(2), process.env);

  if (!args.marker || !args.runId) {
    printJson({
      ok: false,
      error: "missing_marker_or_run_id",
      required: [
        `${TEST_MARKER_ENV}=PV_CONTROLLED_EVIDENCE_TEST_ROW_...`,
        `${TEST_RUN_ID_ENV}=<uuid>`,
      ],
      mode: args.execute ? "execute" : "dry_run",
    });
    process.exitCode = 1;
    return;
  }

  if (!args.execute) {
    const instruction = buildControlledEvidenceTestRowCleanupInstruction({
      marker: args.marker,
      runId: args.runId,
    });

    printJson({
      ok: true,
      mode: "dry_run",
      cleanupExecuted: false,
      instruction,
      warning: "Dry-run only. Add --execute after verifying marker and run id.",
    });
    return;
  }

  const clientResult = createSupabaseEvidenceClientFromEnv({ useServiceRole: true });
  if (!clientResult.ok) {
    printJson({
      ok: false,
      mode: "execute",
      cleanupExecuted: false,
      error: clientResult.error,
      diagnostics: clientResult.diagnostics,
    });
    process.exitCode = 1;
    return;
  }

  const result = await cleanupControlledEvidenceTestRow(
    { marker: args.marker, runId: args.runId },
    {
      client: clientResult.client as unknown as ControlledEvidenceTestRowCleanupClient,
      execute: true,
    },
  );

  printJson(result);
  if (!result.ok) process.exitCode = 1;
}

export function parseCleanupArgs(argv: string[], env: Record<string, string | undefined> = process.env): CleanupCliArgs {
  const args: CleanupCliArgs = {
    marker: env[TEST_MARKER_ENV] ?? "",
    runId: env[TEST_RUN_ID_ENV] ?? "",
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

    if (flag === "--marker") args.marker = value;
    else if (flag === "--run-id") args.runId = value;
  }

  return args;
}

function readFlagValue(token: string, nextToken: string | undefined): { flag: string; value: string; consumedNext: boolean } {
  const [flag, inlineValue] = token.split("=", 2);
  if (typeof inlineValue === "string") return { flag, value: inlineValue, consumedNext: false };
  if (flag.startsWith("--")) return { flag, value: nextToken ?? "", consumedNext: true };
  return { flag, value: "", consumedNext: false };
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
