import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import {
  updateShelfItemPriceAction,
  type UpdatePriceResult,
} from "../../../../../server/price-capture";

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

  const companyId = membershipResult.membership.companyId;

  // Получаем JSON тело
  let body: { itemId: string; price: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { itemId, price } = body;

  if (!itemId || typeof itemId !== "string") {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  // Цена в рублях → переводим в копейки
  let priceMinor: number | null = null;
  if (price !== null && price !== undefined) {
    if (typeof price !== "number" || isNaN(price) || price < 0) {
      return NextResponse.json({ error: "Invalid price value" }, { status: 400 });
    }
    priceMinor = Math.round(price * 100);
  }

  const result: UpdatePriceResult = await updateShelfItemPriceAction(itemId, priceMinor, companyId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
