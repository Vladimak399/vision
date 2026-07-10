import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

type SourceStoreRow = {
  source_store_id: string | null;
  source_city: string | null;
  source_address: string | null;
  store_id: string | null;
  stores: { name: string | null } | Array<{ name: string | null }> | null;
};

type OnlineSourceRow = {
  id: string;
  source_key: string;
  display_name: string;
  base_url: string | null;
  enabled: boolean;
  legal_status: string;
  rate_limit_per_minute: number | null;
  parser_config: unknown;
  last_run_at: string | null;
  last_run_status: string | null;
  source_stores: SourceStoreRow[] | null;
};

function getStoreName(stores: SourceStoreRow["stores"]): string | null {
  if (Array.isArray(stores)) {
    return stores[0]?.name ?? null;
  }

  return stores?.name ?? null;
}

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

  // Fetch all sources for the company
  const { data: sources, error } = await supabase
    .from("online_sources")
    .select(`
      id,
      source_key,
      display_name,
      base_url,
      enabled,
      legal_status,
      rate_limit_per_minute,
      parser_config,
      last_run_at,
      last_run_status,
      source_stores (
        source_id,
        store_id,
        source_store_id,
        source_city,
        source_address,
        stores:store_id (
          id,
          name
        )
      )
    `)
    .eq("company_id", companyId)
    .order("display_name", { ascending: true });

  if (error) {
    console.error("Error fetching sources:", error);
    return NextResponse.json({ error: "Failed to fetch sources" }, { status: 500 });
  }

  // Transform data to frontend format
  const transformed = ((sources ?? []) as unknown as OnlineSourceRow[]).map((source) => ({
    id: source.id,
    source_key: source.source_key,
    display_name: source.display_name,
    base_url: source.base_url,
    enabled: source.enabled,
    legal_status: source.legal_status,
    rate_limit_per_minute: source.rate_limit_per_minute,
    parser_config: source.parser_config,
    last_run_at: source.last_run_at,
    last_run_status: source.last_run_status,
    source_stores: (source.source_stores ?? []).map((ss) => ({
      source_store_id: ss.source_store_id ?? "",
      source_city: ss.source_city ?? "",
      source_address: ss.source_address ?? "",
      store_id: ss.store_id ?? "",
      store_name: getStoreName(ss.stores),
    })),
  }));

  return NextResponse.json(transformed);
}
