import { readFileSync } from "node:fs";
import {
  buildRealPhotoFailureReport,
  debugWritePlanJsonToPhotoSummary,
  type RealPhotoDebugSummary,
} from "../server/price-capture/real-photo-failure-report";

export type RealPhotoFailureReportCliArgs = {
  files: string[];
  expectedMinimumDetectionsPerPhoto: number | null;
  lowMatchConfidenceThreshold: number | null;
  compact: boolean;
};

export function parseRealPhotoFailureReportArgs(argv: string[]): RealPhotoFailureReportCliArgs {
  const args: RealPhotoFailureReportCliArgs = {
    files: [],
    expectedMinimumDetectionsPerPhoto: null,
    lowMatchConfidenceThreshold: null,
    compact: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--compact") {
      args.compact = true;
      continue;
    }

    const { flag, value, consumedNext } = readFlagValue(token, argv[index + 1]);
    if (consumedNext) index += 1;

    if (flag === "--min-detections") args.expectedMinimumDetectionsPerPhoto = parsePositiveInt(value);
    else if (flag === "--low-match-threshold") args.lowMatchConfidenceThreshold = parseFloatOrNull(value);
    else if (!token.startsWith("--")) args.files.push(token);
  }

  return args;
}

export function buildRealPhotoFailureReportFromFiles(input: {
  files: string[];
  expectedMinimumDetectionsPerPhoto?: number | null;
  lowMatchConfidenceThreshold?: number | null;
}): string {
  if (input.files.length === 0) {
    throw new Error("At least one debug:evidence-write-plan JSON file is required.");
  }

  const photos: RealPhotoDebugSummary[] = input.files.map((file) => debugWritePlanJsonToPhotoSummary({
    photo: file,
    json: readFileSync(file, "utf8"),
  }));

  return JSON.stringify(buildRealPhotoFailureReport({
    photos,
    expectedMinimumDetectionsPerPhoto: input.expectedMinimumDetectionsPerPhoto,
    lowMatchConfidenceThreshold: input.lowMatchConfidenceThreshold,
  }), null, 2);
}

function main(): void {
  const args = parseRealPhotoFailureReportArgs(process.argv.slice(2));

  try {
    const json = buildRealPhotoFailureReportFromFiles({
      files: args.files,
      expectedMinimumDetectionsPerPhoto: args.expectedMinimumDetectionsPerPhoto,
      lowMatchConfidenceThreshold: args.lowMatchConfidenceThreshold,
    });
    if (args.compact) {
      process.stdout.write(`${JSON.stringify(JSON.parse(json))}\n`);
    } else {
      process.stdout.write(`${json}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function readFlagValue(token: string, nextToken: string | undefined): { flag: string; value: string; consumedNext: boolean } {
  const [flag, inlineValue] = token.split("=", 2);
  if (typeof inlineValue === "string") return { flag, value: inlineValue, consumedNext: false };
  if (flag.startsWith("--")) return { flag, value: nextToken ?? "", consumedNext: true };
  return { flag, value: "", consumedNext: false };
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseFloatOrNull(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

if (require.main === module) {
  main();
}
