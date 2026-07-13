import Excel from "exceljs";

import { getLatestPrices, type PriceObservationMode } from "./price-observations";
import { createSupabaseServiceRoleClient } from "../lib/supabase/service-role";
import { getPrimaryCompanyMembership } from "./primary-membership";
import {
  parseMonitoringTemplate,
  splitStoreLabel,
  type Department,
  type ParsedTemplateColumn,
} from "./template-parser";
import {
  type ExportPreflightReport,
  type ExportPreflightStoreCoverage,
  type ExportPreflightLowConfidenceSample,
  type ExportPreflightMode,
} from "./template-export-types";

type Week = 1 | 2;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceRoleClient>;

/** Порог уверенности matching: ниже — считается рискованным (low-confidence). */
const LOW_CONFIDENCE_THRESHOLD = 0.7;
/** Порог общего покрытия, ниже которого выдаём предупреждение. */
const LOW_COVERAGE_THRESHOLD_PCT = 50;

type PriceRow = {
  catalog_product_id: string | null;
  store_id: string;
  price_minor: number | string | null;
  captured_date: string | null;
  created_at: string | null;
};

type CatalogRow = {
  id: string;
  barcode: string | number | null;
  external_sku: string | number | null;
};

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
};

type ColumnStoreKey = `${Department}:${number}`;

type TemplateExportSuccess = {
  ok: true;
  buffer: Buffer;
  filename: string;
};

type TemplateExportFailure = {
  ok: false;
  error: string;
};

export type TemplateExportResult = TemplateExportSuccess | TemplateExportFailure;

const SHEET_TO_DEPARTMENT: Partial<Record<string, Department>> = {
  Химия: "chemistry",
  Продукты: "products",
};

function normalizeBarcode(value: unknown): string {
  return String(value ?? "").trim().replace(/\.0$/, "");
}

function storeKey(name: string, address: string | null): string {
  return `${name.trim().toLocaleLowerCase("ru-RU")}|${(address ?? "").trim().toLocaleLowerCase("ru-RU")}`;
}

function buildStoreIndex(stores: StoreRow[]) {
  const byNameAddress = new Map<string, string>();
  const idsByName = new Map<string, string[]>();

  for (const store of stores) {
    byNameAddress.set(storeKey(store.name, store.address), store.id);

    const nameKey = store.name.trim().toLocaleLowerCase("ru-RU");
    idsByName.set(nameKey, [...(idsByName.get(nameKey) ?? []), store.id]);
  }

  return { byNameAddress, idsByName };
}

function resolveStoreId(
  label: string,
  storeIndex: ReturnType<typeof buildStoreIndex>,
): string | null {
  const { name, address } = splitStoreLabel(label);

  if (!name) {
    return null;
  }

  // 1. Точный матч по названию + адресу
  const exactMatch = storeIndex.byNameAddress.get(storeKey(name, address));
  if (exactMatch) {
    return exactMatch;
  }

  // 2. Если точный матч не нашёлся — пробуем по названию без адреса
  const matchesByName = storeIndex.idsByName.get(name.toLocaleLowerCase("ru-RU")) ?? [];
  if (matchesByName.length === 1) {
    return matchesByName[0];
  }

  // 3. Если несколько магазинов с таким именем — неоднозначно, пропускаем
  return null;
}

function toPriceMinor(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  const price = typeof value === "number" ? value : Number(value);
  return Number.isFinite(price) ? price : null;
}

function buildPriceMap(rows: PriceRow[]): Map<string, Map<string, number>> {
  const priceMap = new Map<string, Map<string, number>>();
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row.catalog_product_id) {
      continue;
    }

    const priceMinor = toPriceMinor(row.price_minor);
    if (priceMinor === null) {
      continue;
    }

    const key = `${row.catalog_product_id}|${row.store_id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const storePriceMap = priceMap.get(row.catalog_product_id) ?? new Map<string, number>();
    storePriceMap.set(row.store_id, priceMinor);
    priceMap.set(row.catalog_product_id, storePriceMap);
  }

  return priceMap;
}

function buildBarcodeMap(catalog: CatalogRow[]): Map<string, string> {
  const barcodeToCatalogId = new Map<string, string>();

  for (const product of catalog) {
    const candidates = [product.barcode, product.external_sku]
      .map(normalizeBarcode)
      .filter(Boolean);

    for (const barcode of candidates) {
      if (!barcodeToCatalogId.has(barcode)) {
        barcodeToCatalogId.set(barcode, product.id);
      }
    }
  }

  return barcodeToCatalogId;
}

function buildColumnStoreMap(
  columns: ParsedTemplateColumn[],
  stores: StoreRow[],
): Map<ColumnStoreKey, string> {
  const storeIndex = buildStoreIndex(stores);
  const columnToStoreId = new Map<ColumnStoreKey, string>();

  for (const column of columns) {
    if (column.priceKind !== "competitor") {
      continue;
    }

    const storeId = resolveStoreId(column.storeLabel, storeIndex);
    if (storeId) {
      columnToStoreId.set(columnStoreKey(column), storeId);
    }
  }

  return columnToStoreId;
}

function columnStoreKey(column: ParsedTemplateColumn): ColumnStoreKey {
  return `${column.department}:${column.columnIndex}`;
}

async function loadPriceRows(
  supabaseClient: SupabaseServiceClient,
  companyId: string,
  week: Week,
): Promise<PriceRow[]> {
  const { data, error } = await supabaseClient
    .from("competitor_shelf_items")
    .select("catalog_product_id, store_id, price_minor, captured_date, created_at")
    .eq("company_id", companyId)
    .eq("week", week)
    .not("catalog_product_id", "is", null)
    .not("price_minor", "is", null)
    .order("captured_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Ошибка загрузки цен: ${error.message}`);
  }

  return (data ?? []) as PriceRow[];
}

async function loadCatalog(
  supabaseClient: SupabaseServiceClient,
  companyId: string,
): Promise<CatalogRow[]> {
  const { data, error } = await supabaseClient
    .from("catalog_products")
    .select("id, barcode, external_sku")
    .eq("company_id", companyId);

  if (error) {
    throw new Error(`Ошибка загрузки каталога: ${error.message}`);
  }

  return (data ?? []) as CatalogRow[];
}

async function loadStores(
  supabaseClient: SupabaseServiceClient,
  companyId: string,
): Promise<StoreRow[]> {
  const { data, error } = await supabaseClient
    .from("stores")
    .select("id, name, address")
    .eq("company_id", companyId)
    .eq("is_own", false);

  if (error) {
    throw new Error(`Ошибка загрузки магазинов: ${error.message}`);
  }

  return (data ?? []) as StoreRow[];
}

export async function fillTemplateWithPrices(
  fileBuffer: Buffer,
  week: Week,
  companyId: string,
  supabaseClient: SupabaseServiceClient,
  mode: PriceObservationMode = "latest",
): Promise<Buffer> {
  // Читаем шаблон через exceljs — сохраняет форматирование
  const workbook = new Excel.Workbook();
  // exceljs ожидает Node.js Buffer, используем приведение типов
  await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);

  const parsed = await parseMonitoringTemplate(fileBuffer, week);
  const competitorColumns = parsed.columns.filter(
    (column) => column.priceKind === "competitor" && column.week === week,
  );

  const priceObservations = await getLatestPrices(companyId, week, mode);

  // Преобразуем PriceObservationMap в Map<catalog_product_id, Map<store_id, number>>
  const priceMap = new Map<string, Map<string, number>>();
  for (const [catalogId, storeMap] of priceObservations) {
    const inner = new Map<string, number>();
    for (const [storeId, obs] of storeMap) {
      inner.set(storeId, obs.priceMinor);
    }
    priceMap.set(catalogId, inner);
  }

  const catalog = await loadCatalog(supabaseClient, companyId);
  const stores = await loadStores(supabaseClient, companyId);
  const barcodeToCatalogId = buildBarcodeMap(catalog);
  const columnToStoreId = buildColumnStoreMap(competitorColumns, stores);

  // exceljs использует 1-индексацию строк (row 1 = первая строка)
  // parseMonitoringTemplate возвращает rowIndex с 0-индексацией.
  // Конвертируем: exceljsRow = rowIndex + 1
  for (const worksheet of workbook.worksheets) {
    const sheetName = worksheet.name;
    const department = SHEET_TO_DEPARTMENT[sheetName];
    if (!department) {
      continue;
    }

    const columns = competitorColumns.filter((column) => column.department === department);

    // Определяем последнюю строку с данными
    const rowCount = worksheet.rowCount;

    for (let exceljsRow = 3; exceljsRow <= rowCount; exceljsRow += 1) {
      const row = worksheet.getRow(exceljsRow);
      const barcode = normalizeBarcode(row.getCell(2).value); // колонка B = штрихкод (1-индексация: 2)
      if (!barcode || barcode === "0") {
        continue;
      }

      const catalogProductId = barcodeToCatalogId.get(barcode);
      if (!catalogProductId) {
        continue;
      }

      const storePrices = priceMap.get(catalogProductId);
      if (!storePrices) {
        continue;
      }

      for (const column of columns) {
        const storeId = columnToStoreId.get(columnStoreKey(column));
        if (!storeId) {
          continue;
        }

        const priceMinor = storePrices.get(storeId);
        if (priceMinor !== undefined) {
          // exceljs: колонки 1-индексация, column.columnIndex — 0-индексация
          const cell = row.getCell(column.columnIndex + 1);
          cell.value = priceMinor / 100;
        }
      }
    }
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  return buffer;
}

/**
 * Вычисляет отчёт покрытия перед экспортом (preflight).
 *
 * НЕ изменяет формат XLSX — только анализирует, какие цены попадут в файл:
 * - сопоставленные магазины (колонки-конкуренты → stores),
 * - заполненные ячейки цен (filled / total),
 * - колонки без сопоставления с магазином (missing columns),
 * - строки с low-confidence matching.
 *
 * Это read-only анализ: данные БД не меняются, файл не перезаписывается.
 */
export async function computeExportPreflight(
  fileBuffer: Buffer,
  week: Week,
  companyId: string,
  supabaseClient: SupabaseServiceClient,
  mode: PriceObservationMode = "latest",
): Promise<ExportPreflightReport> {
  const parsed = await parseMonitoringTemplate(fileBuffer, week);
  const competitorColumns = parsed.columns.filter(
    (column) => column.priceKind === "competitor" && column.week === week,
  );

  const priceObservations = await getLatestPrices(companyId, week, mode);

  const catalog = await loadCatalog(supabaseClient, companyId);
  const stores = await loadStores(supabaseClient, companyId);
  const barcodeToCatalogId = buildBarcodeMap(catalog);
  const storeIndex = buildStoreIndex(stores);

  // Товары шаблона, чей штрихкод есть в каталоге, сгруппированные по отделу.
  // Это «заполняемые» ячейки: если barcode нет в каталоге — цену не подставить.
  const catalogIdsByDepartment: Record<Department, Set<string>> = {
    products: new Set(),
    chemistry: new Set(),
  };
  let unmappedProductRows = 0;
  for (const product of parsed.products) {
    const catalogId = barcodeToCatalogId.get(product.barcode);
    if (catalogId) {
      catalogIdsByDepartment[product.department].add(catalogId);
    } else {
      unmappedProductRows += 1;
    }
  }

  // Low-confidence строки matching за неделю (только сопоставленные товары).
  const { data: shelfItems, error: shelfError } = await supabaseClient
    .from("competitor_shelf_items")
    .select("raw_name, store_id, match_confidence")
    .eq("company_id", companyId)
    .eq("week", week)
    .not("catalog_product_id", "is", null);

  if (shelfError) {
    throw new Error(`Ошибка загрузки matching: ${shelfError.message}`);
  }

  const lowConfidenceByStore = new Map<
    string,
    { count: number; samples: ExportPreflightLowConfidenceSample[] }
  >();
  for (const row of (shelfItems ?? []) as {
    raw_name: string | null;
    store_id: string;
    match_confidence: number | null;
  }[]) {
    const conf = row.match_confidence;
    if (conf !== null && conf >= LOW_CONFIDENCE_THRESHOLD) {
      continue;
    }
    const entry =
      lowConfidenceByStore.get(row.store_id) ?? { count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < 3) {
      entry.samples.push({
        rawName: row.raw_name ?? "(без названия)",
        storeLabel: "",
        matchConfidence: conf,
      });
    }
    lowConfidenceByStore.set(row.store_id, entry);
  }

  const storeCoverage: ExportPreflightStoreCoverage[] = [];
  const unresolvedColumnLabels: string[] = [];
  let resolvedStores = 0;
  let filledPriceCells = 0;
  let totalPriceCells = 0;
  let lowConfidenceRowCount = 0;
  const lowConfidenceSamples: ExportPreflightLowConfidenceSample[] = [];

  for (const column of competitorColumns) {
    const storeId = resolveStoreId(column.storeLabel, storeIndex);
    const catalogIds = catalogIdsByDepartment[column.department];
    const totalProductRows = catalogIds.size;

    if (!storeId) {
      unresolvedColumnLabels.push(column.storeLabel);
      storeCoverage.push({
        storeLabel: column.storeLabel,
        storeId: null,
        resolved: false,
        filledPriceCells: 0,
        totalProductRows,
        coveragePct: 0,
        lowConfidenceRows: 0,
      });
      continue;
    }

    resolvedStores += 1;

    // Сколько товаров этого отдела имеют цену для данного магазина.
    // priceObservations: Map<catalogProductId, Map<storeId, observation>>
    let columnFilled = 0;
    for (const catalogId of catalogIds) {
      const obsForCatalog = priceObservations.get(catalogId);
      if (obsForCatalog?.has(storeId)) {
        columnFilled += 1;
      }
    }

    filledPriceCells += columnFilled;
    totalPriceCells += totalProductRows;

    const lowEntry = lowConfidenceByStore.get(storeId);
    const lowConfidenceRows = lowEntry?.count ?? 0;
    if (lowEntry) {
      lowConfidenceRowCount += lowEntry.count;
      for (const sample of lowEntry.samples) {
        if (lowConfidenceSamples.length < 10) {
          lowConfidenceSamples.push({ ...sample, storeLabel: column.storeLabel });
        }
      }
    }

    storeCoverage.push({
      storeLabel: column.storeLabel,
      storeId,
      resolved: true,
      filledPriceCells: columnFilled,
      totalProductRows,
      coveragePct: totalProductRows > 0 ? Math.round((columnFilled / totalProductRows) * 100) : 0,
      lowConfidenceRows,
    });
  }

  // Сортируем по покрытию по возрастанию — Problem First.
  storeCoverage.sort((a, b) => a.coveragePct - b.coveragePct);

  const coveragePct =
    totalPriceCells > 0 ? Math.round((filledPriceCells / totalPriceCells) * 100) : 0;

  const warnings: string[] = [];
  if (resolvedStores === 0) {
    warnings.push(
      "Ни одна колонка конкурента не сопоставлена с магазином — файл будет без цен конкурентов.",
    );
  }
  if (resolvedStores > 0 && coveragePct < LOW_COVERAGE_THRESHOLD_PCT) {
    warnings.push(
      `Низкое покрытие цен: заполнено только ${coveragePct}% заполняемых ячеек.`,
    );
  }
  if (unresolvedColumnLabels.length > 0) {
    warnings.push(
      `Колонки без магазина (${unresolvedColumnLabels.length}): ${unresolvedColumnLabels
        .slice(0, 5)
        .join(", ")}${unresolvedColumnLabels.length > 5 ? "…" : ""}.`,
    );
  }
  if (unmappedProductRows > 0) {
    warnings.push(
      `В шаблоне ${unmappedProductRows} товаров, чей штрихкод не найден в каталоге — цены не подставятся.`,
    );
  }
  if (lowConfidenceRowCount > 0) {
    warnings.push(
      `Найдено ${lowConfidenceRowCount} товаров с низкой уверенностью сопоставления (ниже ${LOW_CONFIDENCE_THRESHOLD}).`,
    );
  }

  return {
    ok: true,
    week,
    mode: mode as ExportPreflightMode,
    totalCompetitorColumns: competitorColumns.length,
    resolvedStores,
    unresolvedColumns: unresolvedColumnLabels.length,
    unresolvedColumnLabels,
    filledPriceCells,
    totalPriceCells,
    coveragePct,
    unmappedProductRows,
    lowConfidenceRowCount,
    lowConfidenceSamples,
    storeCoverage,
    warnings,
  };
}

function buildExportFilename(filename: string, week: Week): string {
  const baseName = filename.replace(/\.xlsx?$/i, "") || "monitoring";
  return `${baseName}-filled-week${week}.xlsx`;
}

export async function exportMonitoringExcelAction(
  formData: FormData,
): Promise<TemplateExportResult> {
  "use server";

  const file = formData.get("file");
  const week: Week = formData.get("week") === "2" ? 2 : 1;
  const modeRaw = formData.get("mode");
  const mode: PriceObservationMode =
    modeRaw === "photo_only" || modeRaw === "online_only" || modeRaw === "online_preferred"
      ? modeRaw
      : "latest";

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Выберите XLSX файл шаблона" };
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return { ok: false, error: "Нет доступа к компании" };
  }

  try {
    const supabaseClient = createSupabaseServiceRoleClient();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
const buffer = await fillTemplateWithPrices(
	      fileBuffer,
	      week,
	      membershipResult.membership.companyId,
	      supabaseClient,
	      mode,
	    );

    return {
      ok: true,
      buffer,
      filename: buildExportFilename(file.name, week),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Неизвестная ошибка экспорта",
    };
  }
}

// ── Snapshot export (TASK-36) ───────────────────────────────────────────────

/**
 * Create a snapshot of template export with price data.
 * Returns snapshot_id that can be used to reference this export.
 */
export async function createExportSnapshot(
  supabaseClient: SupabaseServiceClient,
  companyId: string,
  week: Week,
  originalFilename: string,
  priceData: Map<string, Map<string, number>>,
  coverage: {
    totalPriceCells: number;
    filledPriceCells: number;
    coveragePct: number;
    totalStores: number;
    resolvedStores: number;
    unresolvedStores: number;
  },
  warnings: string[],
  triggeredBy?: string,
): Promise<{ snapshotId: string } | null> {
  try {
    // Generate snapshot ID
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0].replace(/-/g, "");
    const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "");
    const snapshotId = `export-${dateStr}-${timeStr}`;

    // Convert price data to JSONB format: catalog_product_id -> store_id -> price_minor
    const priceDataJson: Record<string, Record<string, number>> = {};
    for (const [catalogId, storePrices] of priceData.entries()) {
      const storeMap: Record<string, number> = {};
      for (const [storeId, price] of storePrices.entries()) {
        storeMap[storeId] = price;
      }
      priceDataJson[catalogId] = storeMap;
    }

    // Insert snapshot
    const { error } = await supabaseClient
      .from("template_export_snapshots")
      .insert({
        company_id: companyId,
        week,
        original_filename: originalFilename,
        original_file_size: 0, // TODO: calculate actual file size
        snapshot_id: snapshotId,
        price_data: priceDataJson,
        total_price_cells: coverage.totalPriceCells,
        filled_price_cells: coverage.filledPriceCells,
        coverage_pct: coverage.coveragePct,
        total_stores: coverage.totalStores,
        resolved_stores: coverage.resolvedStores,
        unresolved_stores: coverage.unresolvedStores,
        warnings,
        triggered_by: triggeredBy,
      });

    if (error) {
      console.error("Error creating export snapshot:", error);
      return null;
    }

    return { snapshotId };
  } catch (error) {
    console.error("Error creating export snapshot:", error);
    return null;
  }
}

/**
 * Get snapshot by ID
 */
export async function getExportSnapshot(
  supabaseClient: SupabaseServiceClient,
  snapshotId: string,
): Promise<{
  snapshotId: string;
  week: number;
  originalFilename: string;
  priceData: Record<string, Record<string, number>>;
  coverage: {
    totalPriceCells: number;
    filledPriceCells: number;
    coveragePct: number;
    totalStores: number;
    resolvedStores: number;
    unresolvedStores: number;
  };
  warnings: string[];
  createdAt: string;
} | null> {
  try {
    const { data, error } = await supabaseClient
      .from("template_export_snapshots")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      snapshotId: data.snapshot_id as string,
      week: data.week as number,
      originalFilename: data.original_filename as string,
      priceData: (data.price_data as Record<string, Record<string, number>>) || {},
      coverage: {
        totalPriceCells: data.total_price_cells as number,
        filledPriceCells: data.filled_price_cells as number,
        coveragePct: data.coverage_pct as number,
        totalStores: data.total_stores as number,
        resolvedStores: data.resolved_stores as number,
        unresolvedStores: data.unresolved_stores as number,
      },
      warnings: (data.warnings as string[]) || [],
      createdAt: data.snapshot_created_at as string,
    };
  } catch (error) {
    console.error("Error getting export snapshot:", error);
    return null;
  }
}

/**
 * Get recent snapshots for a company
 */
export async function getRecentSnapshots(
  supabaseClient: SupabaseServiceClient,
  companyId: string,
  limit: number = 10,
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await supabaseClient
      .from("template_export_snapshots")
      .select("*")
      .eq("company_id", companyId)
      .order("snapshot_created_at", { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data as Record<string, unknown>[];
  } catch (error) {
    console.error("Error getting recent snapshots:", error);
    return [];
  }
}
