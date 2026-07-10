import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return NextResponse.json({ error: "No company" }, { status: 403 });
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { sourceId } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = {};

  const allowedFields = [
    "enabled",
    "legal_status",
    "rate_limit_per_minute",
    "parser_config",
    "source_stores",
  ];

  for (const field of allowedFields) {
    if (field in body) {
      const v = (body as Record<string, unknown>)[field];
      if (v !== undefined) updates[field] = v;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("online_sources")
    .update(updates)
    .eq("id", sourceId)
    .eq("company_id", companyId);

  if (error) {
    return NextResponse.json({ error: "Failed to update source" }, { status: 500 });
  }

  if ("source_stores" in updates) {
    await supabase
      .from("online_prices")
      .delete()
      .eq("source_id", sourceId);
  }

  return NextResponse.json({ success: true });
}
