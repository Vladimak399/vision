import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import {
  matchShelfItemsAction,
  type MatchShelfItemsResult,
} from "../../../../../server/price-capture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ storeId: string }>;
};

const initialMatchResult: MatchShelfItemsResult = {
  ok: false,
  week: 1,
  storeId: "",
  storeName: "",
  matched: 0,
  unmatched: 0,
  total: 0,
  errors: [],
};

export async function POST(_request: Request, context: RouteContext) {
  const { storeId } = await context.params;
  const user = await getCurrentUser();

  if (!user) {
    return redirect("/login?next=/app/price-capture");
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return NextResponse.json({ error: "No company access" }, { status: 403 });
  }

  const formData = await _request.formData();
  // Fallback to URL param if formData is empty (e.g. direct GET with query)
  if (!formData.has("week") || !formData.has("storeId")) {
    formData.append("storeId", storeId);
    formData.append("week", _request.url.includes("week=2") ? "2" : "1");
  }

  const week = formData.get("week") as string | null;

  const result = await matchShelfItemsAction(initialMatchResult, formData);

  if (!result.ok) {
    const errorMessage = result.errors.join(", ");
    return redirect(`/app/price-capture/${storeId}?week=${week}&match_error=${encodeURIComponent(errorMessage)}`);
  }

  return redirect(`/app/price-capture/${storeId}?week=${result.week}&matched=${result.matched}&unmatched=${result.unmatched}&total=${result.total}`);
}