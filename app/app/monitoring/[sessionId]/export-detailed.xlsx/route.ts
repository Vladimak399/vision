import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sessionId: string }> };
type ExportSession = { id: string; status: string; created_at: string; stores: { name: string; address: string | null } | null };
type ExportMatch = {
  id: string;
  score: number;
  decision: string;
  is_active: boolean;
  catalog_products: { external_sku: string | null; name: string; brand: string | null; size_text: string | null; own_price_minor: number | null; currency: string | null } | null;
};
type ExportItem = {
  id: string;
  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: string | null;
  confidence: number | null;
  link_confidence: number | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
  review_reason: string | null;
  position_hint: string | null;
  department: string | null;
  status: string;
  created_at: string;
  matches: ExportMatch[] | null;
};
type ExportRow = ReturnType<typeof buildExportRow>;

const EXPORT_STATUSES = ["matched", "confirmed", "unmatched", "needs_review"];
const ROW_WIDTHS = [18, 18, 16, 22, 30, 18, 28, 18, 16, 28, 18, 16, 16, 24, 20, 22, 24, 22, 14, 14, 30, 30, 18, 22, 18, 18, 18, 18, 18, 36];

export async function GET(_request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const user = await getCurrentUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Access check failed" }, { status: 500 });
  }

  if (membershipResult.status !== "ok") return NextResponse.json({ error: "No company access" }, { status: 403 });

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status, created_at, stores(name, address)")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle()
    .returns<ExportSession | null>();

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { data: items, error: itemsError } = await supabase
    .from("recognized_items")
    .select("id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, confidence, link_confidence, price_tag_text, product_visible_text, review_reason, position_hint, department, status, created_at, matches(id, score, decision, is_active, catalog_products(external_sku, name, brand, size_text, own_price_minor, currency))")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", EXPORT_STATUSES)
    .order("created_at", { ascending: true })
    .returns<ExportItem[]>();

  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  const rows = (items ?? []).map((item) => buildExportRow(item));
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["Параметр", "Значение"],
    ["Компания", membershipResult.membership.companyName],
    ["Магазин", session.stores?.name ?? ""],
    ["Адрес", session.stores?.address ?? ""],
    ["ID сессии", session.id],
    ["Статус сессии", session.status],
    ["Создана", formatDateTime(session.created_at)],
    ["Строк в экспорте", String(rows.length)],
    ["Продукты", String(rows.filter((row) => row["Отдел"] === "Продукты").length)],
    ["Химия", String(rows.filter((row) => row["Отдел"] === "Химия").length)],
    ["Сопоставлено", String(rows.filter((row) => row["Каталог товар"]).length)],
    ["Не найдено в ассортименте", String(notFoundRows(rows).length)],
    ["На проверку", String(reviewRows(rows).length)],
    ["Фильтр статусов", EXPORT_STATUSES.join(", ")],
  ]);

  summarySheet["!cols"] = [{ wch: 28 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Сводка");
  appendRowsSheet(workbook, "Товары", rows, "Нет товаров для экспорта");
  appendRowsSheet(workbook, "Продукты", rows.filter((row) => row["Отдел"] === "Продукты"), "Нет товаров по продуктам");
  appendRowsSheet(workbook, "Химия", rows.filter((row) => row["Отдел"] === "Химия"), "Нет товаров по химии");
  appendRowsSheet(workbook, "Не найдено", notFoundRows(rows), "Нет товаров с пометкой не найдено");
  appendRowsSheet(workbook, "На проверку", reviewRows(rows), "Нет товаров, требующих проверки");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const filename = buildFilename(session.stores?.name ?? "monitoring", session.id);

  return new NextResponse(buffer, {
    headers: {
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Cache-Control": "no-store",
    },
  });
}

function buildExportSummary(items: ExportItem[]) {
  return items.reduce(
    (summary, item) => {
      const activeMatch = item.matches?.find((match) => match.is_active) ?? null;
      const hasCatalogProduct = Boolean(activeMatch?.catalog_products);
      if (item.status === "matched") summary.matched += 1;
      if (item.status === "unmatched") summary.unmatched += 1;
      if (item.status === "needs_review") {
        summary.needsReview += 1;
        if (hasCatalogProduct) summary.needsReviewWithCandidate += 1;
        else summary.needsReviewWithoutCandidate += 1;
      }
      if (hasLargePriceDiff(item, activeMatch)) summary.largePriceDiff += 1;
      return summary;
    },
    { matched: 0, unmatched: 0, needsReview: 0, needsReviewWithCandidate: 0, needsReviewWithoutCandidate: 0, largePriceDiff: 0 },
  );
}

function hasLargePriceDiff(item: ExportItem, activeMatch: ExportMatch | null) {
  const product = activeMatch?.catalog_products ?? null;
  const competitorPrice = item.promo_price_minor ?? item.price_minor;
  const ownPrice = product?.own_price_minor ?? null;
  if (competitorPrice === null || ownPrice === null || ownPrice <= 0) return false;
  return Math.abs((competitorPrice - ownPrice) / ownPrice) >= 0.05;
}

function buildExportRow(item: ExportItem) {
  const activeMatch = item.matches?.find((match) => match.is_active) ?? null;
  const product = activeMatch?.catalog_products ?? null;
  const competitorPrice = item.promo_price_minor ?? item.price_minor;
  const ownPrice = product?.own_price_minor ?? null;
  const diffMinor = competitorPrice !== null && ownPrice !== null ? competitorPrice - ownPrice : null;
  const diffPercent = competitorPrice !== null && ownPrice !== null && ownPrice > 0 ? diffMinor! / ownPrice : null;
  const notFound = item.status === "unmatched";
  const needsAttention = notFound || item.status === "needs_review" || !product || (diffPercent !== null && Math.abs(diffPercent) >= 0.05);

  return {
    "Отдел": item.department === "products" ? "Продукты" : item.department === "chemistry" ? "Химия" : "Без отдела",
    "Статус проверки": item.status,
    "Нужно внимание": needsAttention ? "Да" : "Нет",
    "Не найдено в ассортименте": notFound ? "Да" : "Нет",
    "Комментарий": buildComment(item, Boolean(product), notFound, diffPercent),
    "Каталог SKU": product?.external_sku ?? "",
    "Каталог товар": product?.name ?? "",
    "Каталог бренд": product?.brand ?? "",
    "Каталог размер": product?.size_text ?? "",
    "Товар с фото": item.raw_name,
    "Бренд с фото": item.brand ?? "",
    "Размер с фото": item.size_text ?? "",
    "Наша цена": money(ownPrice),
    "Цена конкурента итоговая": money(competitorPrice),
    "Цена конкурента обычная": money(item.price_minor),
    "Старая цена конкурента": money(item.old_price_minor),
    "Акционная цена конкурента": money(item.promo_price_minor),
    "Разница конкурент-наша": money(diffMinor),
    "Разница %": percent(diffPercent),
    "Валюта": item.currency ?? product?.currency ?? "RUB",
    "Текст ценника": item.price_tag_text ?? "",
    "Текст товара": item.product_visible_text ?? "",
    "Место на фото": item.position_hint ?? "",
    "Причина проверки": item.review_reason ?? "",
    "Уверенность OCR": percent(item.confidence),
    "Уверенность связи": percent(item.link_confidence),
    "Match decision": activeMatch?.decision ?? "",
    "Match score": activeMatch ? percent(activeMatch.score) : "",
    "Создано": formatDateTime(item.created_at),
    "ID recognized_item": item.id,
  };
}

function appendRowsSheet(workbook: XLSX.WorkBook, name: string, rows: ExportRow[], emptyMessage: string) {
  const sheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ "Статус": emptyMessage }]);
  sheet["!cols"] = ROW_WIDTHS.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function notFoundRows(rows: ExportRow[]) {
  return rows.filter((row) => row["Не найдено в ассортименте"] === "Да");
}

function reviewRows(rows: ExportRow[]) {
  return rows.filter((row) => row["Нужно внимание"] === "Да" || row["Статус проверки"] === "needs_review");
}

function buildComment(item: ExportItem, productFound: boolean, notFound: boolean, diffPercent: number | null) {
  if (notFound) return "Подтверждено: не продаём / нет в ассортименте";
  if (!productFound) return item.review_reason || "Нет уверенного совпадения с каталогом, проверить вручную";
  if (item.status === "needs_review") return item.review_reason || "Нужно проверить вручную";
  if (diffPercent !== null && diffPercent <= -0.05) return "Конкурент дешевле нашей цены на 5%+";
  if (diffPercent !== null && diffPercent >= 0.05) return "Конкурент дороже нашей цены на 5%+";
  return "";
}

function money(value: number | null) {
  return value === null || !Number.isFinite(value) ? "" : value / 100;
}

function percent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "" : `${Math.round(value * 1000) / 10}%`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU");
}

function buildFilename(storeName: string, sessionId: string) {
  const safeStore = storeName.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "monitoring";
  return `monitoring-detailed-${safeStore}-${sessionId.slice(0, 8)}.xlsx`;
}
