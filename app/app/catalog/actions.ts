"use server";

import Papa from "papaparse";
import * as XLSX from "xlsx";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { createCatalogProduct } from "../../../server/catalog";
import { CATALOG_WRITE_ROLES, hasCompanyRole, roleList } from "../../../server/company-access";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";

export type CatalogImportResult = {
  processed: number;
  created: number;
  updated: number;
  errors: string[];
};

const initialImportResult: CatalogImportResult = {
  processed: 0,
  created: 0,
  updated: 0,
  errors: [],
};

const EXISTING_SKU_LOOKUP_BATCH_SIZE = 100;

type ImportRow = Record<string, unknown>;

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function valueAsString(row: ImportRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

function parseRubPriceToMinor(value: string): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

function normalizeRows(rows: ImportRow[]): ImportRow[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])),
  );
}

async function parseCsv(buffer: Buffer): Promise<ImportRow[]> {
  const csv = buffer.toString("utf8");
  const result = Papa.parse<ImportRow>(csv, {
    header: true,
    skipEmptyLines: true,
    delimiter: "",
    delimitersToGuess: [",", ";", "\t", "|"],
  });

  const fatalErrors = result.errors.filter((error) => error.code !== "TooFewFields" && error.code !== "TooManyFields");
  if (fatalErrors.length > 0) {
    throw new Error(fatalErrors.map((error) => error.message).join("; "));
  }

  return normalizeRows(result.data);
}

async function parseImportFile(file: File): Promise<ImportRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (extension === "xlsx" || extension === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return [];
    }

    return normalizeRows(XLSX.utils.sheet_to_json<ImportRow>(workbook.Sheets[firstSheetName], { defval: "" }));
  }

  return parseCsv(buffer);
}

export async function importCatalogAction(
  _previousState: CatalogImportResult,
  formData: FormData,
): Promise<CatalogImportResult> {
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { ...initialImportResult, errors: ["Выберите CSV или XLSX файл для импорта"] };
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return { ...initialImportResult, errors: ["Нет доступа к компании"] };
  }

  if (!hasCompanyRole(membershipResult.membership, CATALOG_WRITE_ROLES)) {
    return {
      ...initialImportResult,
      errors: [`Недостаточно прав. Импортировать каталог могут только ${roleList(CATALOG_WRITE_ROLES)}.`],
    };
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();

  let rows: ImportRow[] = [];
  try {
    rows = await parseImportFile(file);
  } catch (error) {
    return {
      ...initialImportResult,
      errors: [`Не удалось прочитать файл: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const result: CatalogImportResult = { ...initialImportResult };

  const { data: importRecord, error: importError } = await supabase
    .from("catalog_imports")
    .insert({
      company_id: companyId,
      filename: file.name,
      status: "processing",
      row_count: rows.length,
      error_count: 0,
    })
    .select("id")
    .single();

  if (importError || !importRecord) {
    return {
      ...initialImportResult,
      errors: [`Не удалось создать запись импорта: ${importError?.message ?? "нет данных"}`],
    };
  }

  const skus = Array.from(
    new Set(
      rows
        .map((row) => valueAsString(row, ["external_sku", "sku", "артикул"]))
        .filter((sku): sku is string => Boolean(sku)),
    ),
  );
  const existingSkus = new Set<string>();

  for (let index = 0; index < skus.length; index += EXISTING_SKU_LOOKUP_BATCH_SIZE) {
    const skuBatch = skus.slice(index, index + EXISTING_SKU_LOOKUP_BATCH_SIZE);
    const { data: existingProducts, error: existingError } = await supabase
      .from("catalog_products")
      .select("external_sku")
      .eq("company_id", companyId)
      .in("external_sku", skuBatch);

    if (existingError) {
      return {
        ...initialImportResult,
        errors: [`Не удалось проверить существующие товары: ${existingError.message}`],
      };
    }

    for (const product of existingProducts ?? []) {
      existingSkus.add(String(product.external_sku));
    }
  }

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const externalSku = valueAsString(row, ["external_sku", "sku", "артикул"]);
    const name = valueAsString(row, ["name", "название", "наименование"]);
    const brand = valueAsString(row, ["brand", "бренд"]);
    const sizeText = valueAsString(row, ["size_text", "size", "размер"]);
    const priceRub = valueAsString(row, ["price", "price_rub", "цена", "цена_руб"]);
    const ownPriceMinor = parseRubPriceToMinor(priceRub);
    let rowError: string | null = null;
    let catalogProductId: string | null = null;

    result.processed += 1;

    if (!externalSku) {
      rowError = "external_sku обязателен";
    } else if (!name) {
      rowError = "name обязателен";
    }

    if (!rowError) {
      const existedBefore = existingSkus.has(externalSku);
      const { data: product, error: productError } = await supabase
        .from("catalog_products")
        .upsert(
          {
            company_id: companyId,
            external_sku: externalSku,
            name,
            brand: brand || null,
            size_text: sizeText || null,
            own_price_minor: ownPriceMinor,
            currency: "RUB",
            is_active: true,
          },
          { onConflict: "company_id,external_sku" },
        )
        .select("id")
        .single();

      if (productError || !product) {
        rowError = productError?.message ?? "товар не был сохранен";
      } else {
        catalogProductId = String(product.id);
        if (existedBefore) {
          result.updated += 1;
        } else {
          result.created += 1;
          existingSkus.add(externalSku);
        }
      }
    }

    if (rowError) {
      result.errors.push(`Строка ${rowNumber}: ${rowError}`);
    }

    const { error: rowInsertError } = await supabase.from("catalog_import_rows").insert({
      import_id: importRecord.id,
      row_number: rowNumber,
      raw_data: row,
      error: rowError,
      catalog_product_id: catalogProductId,
    });

    if (rowInsertError) {
      result.errors.push(`Строка ${rowNumber}: не удалось записать результат импорта (${rowInsertError.message})`);
    }
  }

  await supabase
    .from("catalog_imports")
    .update({
      status: result.errors.length > 0 ? "completed_with_errors" : "completed",
      error_count: result.errors.length,
    })
    .eq("id", importRecord.id);

  return result;
}

export async function createProductAction(formData: FormData) {
  try {
    const externalSku = formData.get("external_sku");
    const name = formData.get("name");
    const brand = formData.get("brand");
    const sizeText = formData.get("size_text");
    const ownPriceStr = formData.get("own_price_minor");
    const currency = formData.get("currency");

    if (!externalSku || typeof externalSku !== "string") {
      throw new Error("external_sku is required");
    }
    if (!name || typeof name !== "string") {
      throw new Error("name is required");
    }

    const ownPriceMinor = ownPriceStr && typeof ownPriceStr === "string" ? BigInt(ownPriceStr) : undefined;
    const brandValue = brand && typeof brand === "string" && brand.trim() ? brand.trim() : null;
    const sizeTextValue = sizeText && typeof sizeText === "string" && sizeText.trim() ? sizeText.trim() : null;
    const currencyValue = currency && typeof currency === "string" ? currency : "RUB";

    await createCatalogProduct(externalSku.trim(), name.trim(), {
      brand: brandValue,
      sizeText: sizeTextValue,
      ownPriceMinor,
      currency: currencyValue,
    });
  } catch (error) {
    console.error("Error creating product:", error);
    throw error;
  }
}
