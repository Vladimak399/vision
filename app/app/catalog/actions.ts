"use server";

import Papa from "papaparse";
import Excel from "exceljs";

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

const EXISTING_SKU_LOOKUP_BATCH_SIZE = 250;
const PRODUCT_UPSERT_BATCH_SIZE = 250;
const IMPORT_ROW_INSERT_BATCH_SIZE = 500;
const RECENT_PROCESSING_IMPORT_MINUTES = 10;

type ImportRow = Record<string, unknown>;

type ValidImportRow = {
  rowNumber: number;
  rawData: ImportRow;
  externalSku: string;
  name: string;
  brand: string | null;
  sizeText: string | null;
  ownPriceMinor: number | null;
};

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

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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

  if (extension === "xlsx") {
    const workbook = new Excel.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    const headers = Array.from({ length: worksheet.columnCount }, (_, index) =>
      normalizeHeader(String(excelValue(worksheet.getCell(1, index + 1).value))),
    );
    const rows: ImportRow[] = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = Object.fromEntries(headers.flatMap((header, index) =>
        header ? [[header, excelValue(worksheet.getCell(rowNumber, index + 1).value)]] : [],
      ));
      if (Object.values(row).some((value) => String(value).trim())) rows.push(row);
    }

    return rows;
  }

  if (extension === "xls") throw new Error("Формат XLS не поддерживается. Сохраните файл как XLSX или CSV.");

  return parseCsv(buffer);
}

function excelValue(value: Excel.CellValue): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return excelValue(value.result as Excel.CellValue);
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    return String(value);
  }
  return value;
}

async function markImportFailed(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, importId: string | null, message: string) {
  if (!importId) {
    return;
  }

  await supabase
    .from("catalog_imports")
    .update({ status: "failed", error_count: 1 })
    .eq("id", importId);

  console.error("Catalog import failed", { importId, message });
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
  let importId: string | null = null;

  try {
    const recentProcessingSince = new Date(Date.now() - RECENT_PROCESSING_IMPORT_MINUTES * 60 * 1000).toISOString();
    const { data: activeImport, error: activeImportError } = await supabase
      .from("catalog_imports")
      .select("id, created_at")
      .eq("company_id", companyId)
      .eq("filename", file.name)
      .eq("status", "processing")
      .gte("created_at", recentProcessingSince)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeImportError) {
      return { ...initialImportResult, errors: [`Не удалось проверить активные импорты: ${activeImportError.message}`] };
    }

    if (activeImport) {
      return {
        ...initialImportResult,
        errors: ["Этот файл уже импортируется. Подождите завершения текущего импорта и попробуйте снова."],
      };
    }

    let rows: ImportRow[] = [];
    try {
      rows = await parseImportFile(file);
    } catch (error) {
      return {
        ...initialImportResult,
        errors: [`Не удалось прочитать файл: ${error instanceof Error ? error.message : String(error)}`],
      };
    }

    const result: CatalogImportResult = { ...initialImportResult, processed: rows.length, errors: [] };

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
    importId = String(importRecord.id);

    const validRows: ValidImportRow[] = [];
    const importRowRecords: Record<string, unknown>[] = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const externalSku = valueAsString(row, ["external_sku", "sku", "артикул"]);
      const name = valueAsString(row, ["name", "название", "наименование"]);
      const brand = valueAsString(row, ["brand", "бренд"]);
      const sizeText = valueAsString(row, ["size_text", "size", "размер"]);
      const priceRub = valueAsString(row, ["price", "price_rub", "цена", "цена_руб"]);
      let rowError: string | null = null;

      if (!externalSku) {
        rowError = "external_sku обязателен";
      } else if (!name) {
        rowError = "name обязателен";
      }

      if (rowError) {
        result.errors.push(`Строка ${rowNumber}: ${rowError}`);
        importRowRecords.push({ import_id: importId, row_number: rowNumber, raw_data: row, error: rowError, catalog_product_id: null });
        continue;
      }

      validRows.push({
        rowNumber,
        rawData: row,
        externalSku,
        name,
        brand: brand || null,
        sizeText: sizeText || null,
        ownPriceMinor: parseRubPriceToMinor(priceRub),
      });
    }

    const uniqueSkus = Array.from(new Set(validRows.map((row) => row.externalSku)));
    const existingSkus = new Set<string>();

    for (const skuBatch of chunkArray(uniqueSkus, EXISTING_SKU_LOOKUP_BATCH_SIZE)) {
      const { data: existingProducts, error: existingError } = await supabase
        .from("catalog_products")
        .select("external_sku")
        .eq("company_id", companyId)
        .in("external_sku", skuBatch);

      if (existingError) {
        throw new Error(`Не удалось проверить существующие товары: ${existingError.message}`);
      }

      for (const product of existingProducts ?? []) {
        existingSkus.add(String(product.external_sku));
      }
    }

    const productBySku = new Map<string, ValidImportRow>();
    for (const row of validRows) {
      productBySku.set(row.externalSku, row);
    }

    const productPayloads = Array.from(productBySku.values()).map((row) => ({
      company_id: companyId,
      external_sku: row.externalSku,
      name: row.name,
      brand: row.brand,
      size_text: row.sizeText,
      own_price_minor: row.ownPriceMinor,
      currency: "RUB",
      is_active: true,
    }));

    for (const productBatch of chunkArray(productPayloads, PRODUCT_UPSERT_BATCH_SIZE)) {
      const { error: upsertError } = await supabase
        .from("catalog_products")
        .upsert(productBatch, { onConflict: "company_id,external_sku" });

      if (upsertError) {
        throw new Error(`Не удалось сохранить товары: ${upsertError.message}`);
      }
    }

    const productIdBySku = new Map<string, string>();
    for (const skuBatch of chunkArray(uniqueSkus, EXISTING_SKU_LOOKUP_BATCH_SIZE)) {
      const { data: products, error: productLookupError } = await supabase
        .from("catalog_products")
        .select("id, external_sku")
        .eq("company_id", companyId)
        .in("external_sku", skuBatch);

      if (productLookupError) {
        throw new Error(`Не удалось получить сохраненные товары: ${productLookupError.message}`);
      }

      for (const product of products ?? []) {
        productIdBySku.set(String(product.external_sku), String(product.id));
      }
    }

    for (const sku of uniqueSkus) {
      if (!productIdBySku.has(sku)) {
        result.errors.push(`SKU ${sku}: товар не был найден после сохранения`);
      } else if (existingSkus.has(sku)) {
        result.updated += 1;
      } else {
        result.created += 1;
      }
    }

    for (const row of validRows) {
      const productId = productIdBySku.get(row.externalSku) ?? null;
      const rowError = productId ? null : "товар не был найден после сохранения";
      importRowRecords.push({
        import_id: importId,
        row_number: row.rowNumber,
        raw_data: row.rawData,
        error: rowError,
        catalog_product_id: productId,
      });
    }

    for (const rowBatch of chunkArray(importRowRecords, IMPORT_ROW_INSERT_BATCH_SIZE)) {
      const { error: rowInsertError } = await supabase.from("catalog_import_rows").insert(rowBatch);
      if (rowInsertError) {
        throw new Error(`Не удалось записать строки импорта: ${rowInsertError.message}`);
      }
    }

    const { error: finishError } = await supabase
      .from("catalog_imports")
      .update({
        status: result.errors.length > 0 ? "completed_with_errors" : "completed",
        error_count: result.errors.length,
      })
      .eq("id", importId);

    if (finishError) {
      throw new Error(`Не удалось завершить импорт: ${finishError.message}`);
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markImportFailed(supabase, importId, message);
    return { ...initialImportResult, errors: [`Импорт остановлен: ${message}`] };
  }
}

export async function createProductAction(formData: FormData) {
  try {
    // Permission gate (Finding H-3): manual catalog product creation must be
    // restricted to admin/manager, matching importCatalogAction and the
    // catalog_manager_write RLS policy. Reviewers cannot alter the catalog.
    const membershipResult = await getPrimaryCompanyMembership();
    if (membershipResult.status !== "ok" || !membershipResult.membership) {
      throw new Error("Нет доступа к компании.");
    }
    if (!hasCompanyRole(membershipResult.membership, CATALOG_WRITE_ROLES)) {
      throw new Error(
        `Недостаточно прав. Создавать товары каталога могут только ${roleList(CATALOG_WRITE_ROLES)}.`,
      );
    }

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
