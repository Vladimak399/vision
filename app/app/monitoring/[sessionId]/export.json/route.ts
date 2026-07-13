import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sessionId: string }> };

type ReportMatch = {
  score: number;
  decision: string;
  is_active: boolean;
  catalog_products: {
    external_sku: string | null;
    name: string;
    brand: string | null;
    size_text: string | null;
    own_price_minor: number | null;
    currency: string | null;
  } | null;
};

type ReportItem = {
  id: string;
  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: string | null;
  confidence: number;
  link_confidence: number | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
  review_reason: string | null;
  position_hint: string | null;
  status: string;
  bbox: Record<string, number> | null;
  monitoring_photos: { storage_path: string } | null;
  evidence: Array<{ id: string; storage_path: string; bbox: Record<string, number> | null }> | null;
  matches: ReportMatch[] | null;
};

const EXPORT_STATUSES = ["matched", "confirmed", "unmatched", "needs_review"];

export async function GET(_request: Request, { params }: RouteContext) {
  const { sessionId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await getPrimaryCompanyMembership().catch(() => null);
  if (!membership || membership.status !== "ok") {
    return NextResponse.json({ error: "No company access" }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const companyId = membership.membership.companyId;
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status, created_at, stores(name, address)")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("recognized_items")
    .select("id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, confidence, link_confidence, price_tag_text, product_visible_text, review_reason, position_hint, status, bbox, monitoring_photos(storage_path), evidence(id, storage_path, bbox), matches(score, decision, is_active, catalog_products(external_sku, name, brand, size_text, own_price_minor, currency))")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", EXPORT_STATUSES)
    .order("created_at", { ascending: true })
    .returns<ReportItem[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).map(buildReportItem);
  const result = {
    generated_at: new Date().toISOString(),
    session,
    summary: {
      total: items.length,
      matched: items.filter((item) => item.status === "matched" || item.status === "confirmed").length,
      needs_review: items.filter((item) => item.status === "needs_review").length,
      unmatched: items.filter((item) => item.status === "unmatched").length,
    },
    items,
  };

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="monitoring-${sessionId.slice(0, 8)}.json"`,
    },
  });
}

function buildReportItem(item: ReportItem) {
  const match = item.matches?.find((candidate) => candidate.is_active) ?? null;
  const product = match?.catalog_products ?? null;
  const competitorPrice = item.promo_price_minor ?? item.price_minor;
  const ownPrice = product?.own_price_minor ?? null;
  const difference = competitorPrice !== null && ownPrice !== null ? competitorPrice - ownPrice : null;
  const evidence = item.evidence?.[0] ?? null;

  return {
    id: item.id,
    status: item.status,
    product: {
      sku: product?.external_sku ?? null,
      name: product?.name ?? null,
      brand: product?.brand ?? item.brand,
      size: product?.size_text ?? item.size_text,
      recognized_name: item.raw_name,
    },
    prices: {
      competitor_minor: competitorPrice,
      competitor_regular_minor: item.price_minor,
      competitor_old_minor: item.old_price_minor,
      own_minor: ownPrice,
      difference_minor: difference,
      difference_percent: difference !== null && ownPrice !== null && ownPrice > 0 ? difference / ownPrice : null,
      currency: item.currency ?? product?.currency ?? "RUB",
    },
    confidence: {
      ocr: item.confidence,
      price_tag_link: item.link_confidence,
      catalog_match: match?.score ?? null,
    },
    review: {
      required: item.status === "needs_review",
      reason: item.review_reason,
    },
    ocr: {
      price_tag_text: item.price_tag_text,
      product_visible_text: item.product_visible_text,
      position: item.position_hint,
    },
    evidence: {
      source_photo_path: item.monitoring_photos?.storage_path ?? null,
      price_tag_crop_path: evidence?.storage_path ?? null,
      bbox: evidence?.bbox ?? item.bbox,
    },
  };
}
