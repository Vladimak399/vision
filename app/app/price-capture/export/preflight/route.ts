import { NextResponse } from "next/server";

import { createSupabaseServiceRoleClient } from "../../../../../lib/supabase/service-role";
import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import { computeExportPreflight } from "../../../../../server/template-export";
import type { ExportPreflightMode } from "../../../../../server/template-export-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  // Проверка аутентификации
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Проверка доступа к компании
  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return NextResponse.json({ error: "No company access" }, { status: 403 });
  }

  // Получаем FormData
  const formData = await request.formData();
  const file = formData.get("file");
  const weekRaw = formData.get("week");
  const week = weekRaw === "2" ? (2 as const) : (1 as const);
  const modeRaw = formData.get("mode");
  const mode: ExportPreflightMode =
    modeRaw === "photo_only" ||
    modeRaw === "online_only" ||
    modeRaw === "online_preferred"
      ? modeRaw
      : "latest";

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const companyId = membershipResult.membership.companyId;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const serviceClient = createSupabaseServiceRoleClient();
    const report = await computeExportPreflight(
      buffer,
      week,
      companyId,
      serviceClient,
      mode,
    );

    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preflight failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
