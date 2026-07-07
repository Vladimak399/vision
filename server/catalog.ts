import { createSupabaseServerClient } from "../lib/supabase/server";
import { getPrimaryCompanyMembership } from "./primary-membership";

export type CatalogProduct = {
  id: string;
  companyId: string;
  externalSku: string;
  name: string;
  brand: string | null;
  sizeText: string | null;
  ownPriceMinor: bigint | null;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
};

export type CatalogProductSearchParams = {
  q?: string;
  price?: "missing" | "present";
  page?: number;
  pageSize?: number;
};

export type CatalogProductSearchResult = {
  products: CatalogProduct[];
  totalCount: number | null;
  page: number;
  pageSize: number;
};

export type CatalogImportSummary = {
  id: string;
  filename: string;
  status: string;
  rowCount: number | null;
  errorCount: number | null;
  createdAt: string;
};

type CatalogProductRow = {
  id: string;
  company_id: string;
  external_sku: string;
  name: string;
  brand: string | null;
  size_text: string | null;
  own_price_minor: bigint | null;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type CatalogImportRow = {
  id: string;
  filename: string;
  status: string;
  row_count: number | null;
  error_count: number | null;
  created_at: string;
};

function toCatalogProduct(row: CatalogProductRow): CatalogProduct {
  return {
    id: row.id,
    companyId: row.company_id,
    externalSku: row.external_sku,
    name: row.name,
    brand: row.brand,
    sizeText: row.size_text,
    ownPriceMinor: row.own_price_minor,
    currency: row.currency,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function getCatalogProducts(
  companyId: string,
  params: CatalogProductSearchParams = {},
): Promise<CatalogProductSearchResult> {
  const supabase = await createSupabaseServerClient();
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const q = params.q?.trim();

  let query = supabase
    .from("catalog_products")
    .select("*", { count: "exact" })
    .eq("company_id", companyId);

  if (q) {
    const pattern = `*${escapeIlike(q)}*`;
    query = query.or(`external_sku.ilike.${pattern},name.ilike.${pattern},brand.ilike.${pattern},size_text.ilike.${pattern}`);
  }

  if (params.price === "missing") {
    query = query.is("own_price_minor", null);
  } else if (params.price === "present") {
    query = query.not("own_price_minor", "is", null);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<CatalogProductRow[]>();

  if (error) {
    throw new Error(`Failed to load catalog products: ${error.message}`);
  }

  return {
    products: (data ?? []).map(toCatalogProduct),
    totalCount: count,
    page,
    pageSize,
  };
}

export async function getRecentCatalogImports(companyId: string, limit = 5): Promise<CatalogImportSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("catalog_imports")
    .select("id, filename, status, row_count, error_count, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<CatalogImportRow[]>();

  if (error) {
    throw new Error(`Failed to load catalog imports: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    filename: row.filename,
    status: row.status,
    rowCount: row.row_count,
    errorCount: row.error_count,
    createdAt: row.created_at,
  }));
}

export async function createCatalogProduct(
  externalSku: string,
  name: string,
  options: {
    brand?: string | null;
    sizeText?: string | null;
    ownPriceMinor?: bigint | null;
    currency?: string;
  } = {},
): Promise<CatalogProduct> {
  const supabase = await createSupabaseServerClient();

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    throw new Error("User company membership was not found");
  }

  const companyId = membershipResult.membership.companyId;
  const brand = options.brand ?? null;
  const sizeText = options.sizeText ?? null;
  const ownPriceMinor = options.ownPriceMinor ?? null;
  const currency = options.currency ?? "RUB";

  const { data, error } = await supabase
    .from("catalog_products")
    .insert({
      company_id: companyId,
      external_sku: externalSku,
      name,
      brand,
      size_text: sizeText,
      own_price_minor: ownPriceMinor,
      currency,
      is_active: true,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create catalog product: ${error.message}`);
  }

  if (!data) {
    throw new Error("Created catalog product was not returned by the database");
  }

  return toCatalogProduct(data as CatalogProductRow);
}
