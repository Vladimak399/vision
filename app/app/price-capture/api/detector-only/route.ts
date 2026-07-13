import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import {
  handleDetectorOnlyApiRequest,
} from "../../../../../server/price-capture/detector-only-api-boundary";
import {
  buildDetectorOnlyApiRequestFromRouteBody,
  isDetectorOnlyApiRouteEnabled,
  isDetectorOnlyRouteBody,
  type DetectorOnlyRouteBody,
} from "./route-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const parsedBody = await request.json();
    if (!isDetectorOnlyRouteBody(parsedBody)) {
      return NextResponse.json({
        ok: false,
        statusCode: 400,
        error: {
          code: "invalid_json",
          message: "Request body must be a JSON object.",
        },
      }, { status: 400 });
    }

    body = parsedBody;
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
