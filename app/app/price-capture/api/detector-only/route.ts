import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import {
  handleDetectorOnlyApiRequest,
  type DetectorOnlyApiRequest,
} from "../../../../../server/price-capture/detector-only-api-boundary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function POST(request: Request) {
  if (!isDetectorOnlyApiRouteEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return NextResponse.json({ error: "No company access" }, { status: 403 });
  }

  let body: DetectorOnlyRouteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({
      ok: false,
      statusCode: 400,
      error: {
        code: "invalid_json",
        message: "Invalid JSON body.",
      },
    }, { status: 400 });
  }

  const apiRequest = buildDetectorOnlyApiRequestFromRouteBody(
    body,
    membershipResult.membership.companyId,
  );
  const response = await handleDetectorOnlyApiRequest(apiRequest);

  return NextResponse.json(response, { status: response.statusCode });
}

export function isDetectorOnlyApiRouteEnabled(
  value: string | undefined = process.env[DETECTOR_ONLY_API_ROUTE_FEATURE_FLAG],
): boolean {
  return value === "1" || value?.toLowerCase() === "true";
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
