import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { fillTemplateWithPrices } from "../../../../server/template-export";
import type { PriceObservationMode } from "../../../../server/price-observations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return NextResponse.json({ error: "No company access" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const weekRaw = formData.get("week");
  const week = weekRaw === "2" ? (2 as const) : (1 as const);
  const modeRaw = formData.get("mode");
  const mode: PriceObservationMode =
    modeRaw === "photo_only" || modeRaw === "online_only" || modeRaw === "online_preferred"
      ? modeRaw
      : "latest";

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const companyId = membershipResult.membership.companyId;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const serviceClient = createSupabaseServiceRoleClient();
    const outputBuffer = await fillTemplateWithPrices(buffer, week, companyId, serviceClient, mode);

    const originalName = file.name.replace(/\.xlsx?$/i, "");
    const filename = `${originalName}-filled-week${week}.xlsx`;

    return new NextResponse(new Uint8Array(outputBuffer), {
      headers: {
        "Content-Disposition": `attachment; filename="monitoring-week${week}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}