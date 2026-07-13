import type { DetectorOnlyApiRequest } from "../../../../../server/price-capture/detector-only-api-boundary";

export const DETECTOR_ONLY_API_ROUTE_FEATURE_FLAG = "PRICEVISION_DETECTOR_ONLY_API_ENABLED";

type DetectorOnlyRoutePhoto = Partial<DetectorOnlyApiRequest["photo"]>;

export type DetectorOnlyRouteBody = {
  storeId?: string | null;
  week?: 1 | 2 | number | null;
  runId?: string | null;
  capturedDate?: string | null;
  photo?: DetectorOnlyRoutePhoto | null;
  evidence?: DetectorOnlyApiRequest["evidence"];
};

export function isDetectorOnlyApiRouteEnabled(
  value: string | undefined = process.env[DETECTOR_ONLY_API_ROUTE_FEATURE_FLAG],
): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isDetectorOnlyRouteBody(value: unknown): value is DetectorOnlyRouteBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildDetectorOnlyApiRequestFromRouteBody(
  body: DetectorOnlyRouteBody | null | undefined,
  companyId: string,
): DetectorOnlyApiRequest {
  const input = body ?? {};
  const photo = input.photo ?? null;

  return {
    companyId,
    storeId: input.storeId ?? "",
    week: input.week as 1 | 2,
    runId: input.runId ?? null,
    capturedDate: input.capturedDate ?? null,
    photo: {
      bytes: photo?.bytes ?? [],
      filename: photo?.filename ?? null,
      contentType: photo?.contentType ?? null,
      storagePath: photo?.storagePath ?? null,
    },
    evidence: input.evidence,
  };
}
