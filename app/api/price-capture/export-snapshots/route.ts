import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
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

  const { data, error } = await supabase
    .from("template_export_snapshots")
    .select("*")
    .eq("company_id", companyId)
    .order("snapshot_created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Error fetching snapshots:", error);
    return NextResponse.json({ error: "Failed to fetch snapshots" }, { status: 500 });
  }

  return NextResponse.json(data);
}
