"use server";

import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";

async function insertCatalogImport(supabase: any, companyId: string, filename: string, createdBy: string) {
  const { data, error } = await supabase
    .from("catalog_imports")
    .insert({ company_id: companyId, filename, status: "processing", created_by: createdBy })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create catalog_import: ${error.message}`);
  }

  return data.id as string;
}

async function insertCatalogImportRow(supabase: any, importId: string, rowNumber: number, rawData: any, errorText: string | null, catalogProductId: string | null) {
  const { error } = await supabase.from("catalog_import_rows").insert({ import_id: importId, row_number: rowNumber, raw_data: rawData, error: errorText, catalog_product_id: catalogProductId });
  if (error) {
    console.error("Failed to insert import row:", error);
  }
}

async function updateCatalogImportCounts(supabase: any, importId: string, rowCount: number, errorCount: number) {
  const { error } = await supabase.from("catalog_imports").update({ row_count: rowCount, error_count: errorCount, status: "completed" }).eq("id", importId);
  if (error) {
    console.error("Failed to update import counts:", error);
  }
}

async function createOrUpdateCatalogProduct(supabase: any, companyId: string, externalSku: string, name: string, brand: string | null, sizeText: string | null, ownPriceMinor: bigint | null, currency: string | null, actorId: string | null) {
  // Try to select existing
  const { data: existing, error: selectError } = await supabase
    .from("catalog_products")
    .select("id")
    .eq("company_id", companyId)
    .eq("external_sku", externalSku)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Failed to lookup catalog product: ${selectError.message}`);
  }

  if (!existing) {
    const { data, error } = await supabase
      .from("catalog_products")
      .insert({
        company_id: companyId,
        external_sku: externalSku,
        name,
        brand,
        size_text: sizeText,
        own_price_minor: ownPriceMinor,
        currency: currency ?? "RUB",
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to insert catalog product: ${error.message}`);
    }

    return { id: data.id as string, created: true };
  }

  const { data, error } = await supabase
    .from("catalog_products")
    .update({ name, brand, size_text: sizeText, own_price_minor: ownPriceMinor, currency: currency ?? "RUB", updated_by: actorId })
    .eq("id", existing.id)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to update catalog product: ${error.message}`);
  }

  return { id: data.id as string, created: false };
}

export async function importCatalogAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    throw new Error("User company membership was not found");
  }

  const companyId = membershipResult.membership.companyId;

  const file = formData.get("file") as unknown as File | null;
  if (!file) throw new Error("file is required");

  const filename = file.name;
  const arrayBuffer = await file.arrayBuffer();
  let rows: Record<string, any>[] = [];

  try {
    if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    } else {
      const text = new TextDecoder("utf-8").decode(arrayBuffer);
      const parsed = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true });
      if (parsed.errors && parsed.errors.length) {
        throw new Error("CSV parse error: " + parsed.errors.map((e) => e.message).join("; "));
      }
      rows = parsed.data;
    }
  } catch (e) {
    throw new Error(`Failed to parse file: ${e instanceof Error ? e.message : String(e)}`);
  }

  const supabase = await createSupabaseServerClient();

  const importId = await insertCatalogImport(supabase, companyId, filename, user.id ?? null);

  let processed = 0;
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 1;
    const raw = rows[i];
    let errorText: string | null = null;
    let catalogProductId: string | null = null;

    try {
      const externalSkuRaw = raw["external_sku"] ?? raw["sku"] ?? raw["Артикул"] ?? raw["SKU"] ?? "";
      const nameRaw = raw["name"] ?? raw["Название"] ?? raw["name_ru"] ?? "";

      if (!externalSkuRaw || String(externalSkuRaw).trim() === "") {
        throw new Error("external_sku is required");
      }
      if (!nameRaw || String(nameRaw).trim() === "") {
        throw new Error("name is required");
      }

      const externalSku = String(externalSkuRaw).trim();
      const name = String(nameRaw).trim();
      const brand = raw["brand"] ? String(raw["brand"]).trim() : null;
      const sizeText = raw["size_text"] ? String(raw["size_text"]).trim() : null;
      const currency = raw["currency"] ? String(raw["currency"]).trim() : "RUB";

      let ownPriceMinor: bigint | null = null;
      const priceRaw = raw["price"] ?? raw["own_price"] ?? raw["Цена"] ?? raw["price_rub"];
      if (priceRaw !== undefined && priceRaw !== null && String(priceRaw).trim() !== "") {
        const p = Number(String(priceRaw).replace(",", "."));
        if (Number.isNaN(p)) throw new Error("price is not a number");
        ownPriceMinor = BigInt(Math.round(p * 100));
      }

      const res = await createOrUpdateCatalogProduct(supabase, companyId, externalSku, name, brand, sizeText, ownPriceMinor, currency, user.id ?? null);
      catalogProductId = res.id;
      if (res.created) created++; else updated++;
    } catch (e) {
      errorText = e instanceof Error ? e.message : String(e);
      errors++;
    }

    processed++;
    await insertCatalogImportRow(supabase, importId, rowNumber, raw, errorText, catalogProductId);
  }

  await updateCatalogImportCounts(supabase, importId, processed, errors);

  return { processed, created, updated, errors };
}
