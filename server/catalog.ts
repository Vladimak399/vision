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

export async function getCatalogProducts(): Promise<CatalogProduct[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("catalog_products")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<CatalogProductRow[]>();

  if (error) {
    throw new Error(`Failed to load catalog products: ${error.message}`);
  }

  return (data ?? []).map((product) => ({
    id: product.id,
    companyId: product.company_id,
    externalSku: product.external_sku,
    name: product.name,
    brand: product.brand,
    sizeText: product.size_text,
    ownPriceMinor: product.own_price_minor,
    currency: product.currency,
    isActive: product.is_active,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
    createdBy: product.created_by,
    updatedBy: product.updated_by,
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
    .single()
    .returns<CatalogProductRow>();

  if (error) {
    throw new Error(`Failed to create catalog product: ${error.message}`);
  }

  if (!data) {
    throw new Error("Created catalog product was not returned by the database");
  }

  return {
    id: data.id,
    companyId: data.company_id,
    externalSku: data.external_sku,
    name: data.name,
    brand: data.brand,
    sizeText: data.size_text,
    ownPriceMinor: data.own_price_minor,
    currency: data.currency,
    isActive: data.is_active,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    createdBy: data.created_by,
    updatedBy: data.updated_by,
  };
}
