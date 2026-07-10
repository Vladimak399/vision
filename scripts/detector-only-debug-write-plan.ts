import { runDetectorOnlyDebugPersistFromArgs } from "./detector-only-debug-persist";
import {
  buildDebugEvidenceWritePlan,
  type DebugEvidenceWritePlan,
} from "../server/price-capture/debug-evidence-write-plan";
import type { CompetitorShelfItemInsertPayload } from "../server/price-capture/evidence-persistence";

export type DetectorOnlyDebugWritePlanCliOptions = {
  argv: string[];
  maxItems: number | null;
  pretty: boolean;
};

export type DetectorOnlyDebugWritePlanResponse = Record<string, unknown> & {
  evidenceWritePlan: DebugEvidenceWritePlan;
};

export function parseDetectorOnlyDebugWritePlanArgs(argv: string[]): DetectorOnlyDebugWritePlanCliOptions {
  const passthrough: string[] = [];
  let maxItems: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--evidence-write-plan" || token === "--write-plan") continue;

    const [flag, inlineValue] = token.split("=", 2);
    if (flag === "--max-items") {
      const value = inlineValue ?? argv[index + 1] ?? "";
      if (!inlineValue) index += 1;
      const parsed = Number(value);
      maxItems = Number.isFinite(parsed) ? parsed : null;
      continue;
    }

    passthrough.push(token);
  }

  return {
    argv: ensureArgs(passthrough, ["--dry-run-persistence", "--match-product"]),
    maxItems,
    pretty: !passthrough.includes("--compact"),
  };
}

export async function runDetectorOnlyDebugWritePlanFromArgs(argv: string[]): Promise<string> {
  const options = parseDetectorOnlyDebugWritePlanArgs(argv);
  const json = await runDetectorOnlyDebugPersistFromArgs(options.argv);
  return appendEvidenceWritePlanToDebugJson(json, { maxItems: options.maxItems, pretty: options.pretty });
}

export function appendEvidenceWritePlanToDebugJson(
  json: string,
  options: { maxItems?: number | null; pretty?: boolean; nowIso?: string | null } = {},
): string {
  const response = JSON.parse(json) as Record<string, unknown> & {
    persistence?: {
      items?: Array<{ payload?: CompetitorShelfItemInsertPayload }>;
    };
  };
  const payloads = extractPersistencePayloads(response);
  const evidenceWritePlan = buildDebugEvidenceWritePlan({
    evidencePayloads: payloads,
    maxItems: options.maxItems,
    nowIso: options.nowIso,
  });

  const output: DetectorOnlyDebugWritePlanResponse = {
    ...response,
    evidenceWritePlan,
  };

  return JSON.stringify(output, null, options.pretty === false ? 0 : 2);
}

export function extractPersistencePayloads(response: {
  persistence?: {
    items?: Array<{ payload?: CompetitorShelfItemInsertPayload }>;
  };
}): CompetitorShelfItemInsertPayload[] {
  const items = response.persistence?.items;
  if (!Array.isArray(items)) throw new Error("Detector-only debug persistence JSON does not contain persistence.items.");
  const payloads = items.map((item) => item.payload).filter((payload): payload is CompetitorShelfItemInsertPayload => Boolean(payload));
  if (payloads.length === 0) throw new Error("Detector-only debug persistence JSON does not contain insert payloads.");
  return payloads;
}

function ensureArgs(argv: string[], required: string[]): string[] {
  const next = [...argv];
  for (const arg of required) {
    if (!next.includes(arg)) next.push(arg);
  }
  return next;
}

async function main(): Promise<void> {
  try {
    const json = await runDetectorOnlyDebugWritePlanFromArgs(process.argv.slice(2));
    console.log(json);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Detector-only debug write-plan script failed");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
