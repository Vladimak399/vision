import * as XLSX from "xlsx";

/**
 * Парсер шаблона мониторинга Яны.
 *
 * Шаблон = Excel с двумя листами: "Химия" и "Продукты".
 * Шапка:
 *   строка 0 — имена НАШИХ ТТ (объединённые ячейки, охватывают блок колонок).
 *   строка 1 — "Наша цена" + имена КОНКУРЕНТОВ.
 *   колонки 0-1 — "Наименование" и "Штрихкод" (объединены по 2 строки).
 * Товары (строка 2+):
 *   название без штрихкода → категория.
 *   название + штрихкод → товар.
 *
 * Каталог товаров одинаков в обеих неделях; отличаются только наборы магазинов.
 */

export type Department = "products" | "chemistry";

const SHEET_TO_DEPARTMENT: Record<string, Department> = {
  Химия: "chemistry",
  "Продукты": "products",
};

export type ParsedProduct = {
  barcode: string;
  name: string;
  department: Department;
  category: string | null;
  rowIndex: number;
};

export type ParsedStore = {
  /** исходный текст шапки (имя + адрес) — ключ дедупликации */
  label: string;
  name: string;
  address: string | null;
  isOwn: boolean;
};

export type ParsedTemplateColumn = {
  week: 1 | 2;
  department: Department;
  columnIndex: number;
  /** наша ТТ, которой принадлежит блок (для own и competitor колонок) */
  ourStoreLabel: string;
  /** магазин этой колонки */
  storeLabel: string;
  priceKind: "own" | "competitor";
};

export type ParsedTemplate = {
  products: ParsedProduct[];
  stores: ParsedStore[];
  columns: ParsedTemplateColumn[];
};

/**
 * Разбивает шапку колонки вида "Спар, Ленина 60" на имя и адрес.
 * Разделитель — первая запятая. Адрес — всё после неё.
 */
export function splitStoreLabel(label: string): { name: string; address: string | null } {
  const trimmed = label.trim();
  if (!trimmed) {
    return { name: "", address: null };
  }
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) {
    return { name: trimmed, address: null };
  }
  const name = trimmed.slice(0, commaIdx).trim();
  const address = trimmed.slice(commaIdx + 1).trim();
  return { name, address: address || null };
}

/**
 * Определяет блоки наших ТТ по merges в строке 0.
 * Возвращает map: columnIndex → наша ТТ (label), которой принадлежит колонка.
 * Колонки 0-1 (Наименование/Штрихкод) не входят в блоки.
 */
function buildColumnToOwnStore(
  merges: XLSX.Range[] | undefined,
  row0: string[],
): Map<number, string> {
  const map = new Map<number, string>();
  if (!merges) {
    return map;
  }
  for (const merge of merges) {
    // только строка 0
    if (merge.s.r !== 0 || merge.e.r !== 0) {
      continue;
    }
    const startCol = merge.s.c;
    const endCol = merge.e.c;
    // пропускаем шапку товаров (колонки 0-1)
    if (startCol <= 1) {
      continue;
    }
    const label = (row0[startCol] ?? "").toString().trim();
    if (!label) {
      continue;
    }
    for (let c = startCol; c <= endCol; c++) {
      map.set(c, label);
    }
  }
  return map;
}

function parseSheet(
  ws: XLSX.WorkSheet,
  department: Department,
  week: 1 | 2,
): { products: ParsedProduct[]; columns: ParsedTemplateColumn[]; storeLabels: Set<string> } {
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: true, defval: "" });
  const row0 = rows[0] ?? [];
  const row1 = rows[1] ?? [];

  const merges = ws["!merges"];
  const columnToOwnStore = buildColumnToOwnStore(merges, row0);

  const products: ParsedProduct[] = [];
  const storeLabels = new Set<string>();
  const columns: ParsedTemplateColumn[] = [];

  // --- Колонки: проходим по row1, пропускаем 0-1 ---
  for (let c = 2; c < row1.length; c++) {
    const cellLabel = (row1[c] ?? "").toString().trim();
    const ourStoreLabel = columnToOwnStore.get(c);
    if (!cellLabel || !ourStoreLabel) {
      continue;
    }
    storeLabels.add(ourStoreLabel);

    const isOwn = cellLabel.toLowerCase() === "наша цена";
    if (isOwn) {
      columns.push({
        week,
        department,
        columnIndex: c,
        ourStoreLabel,
        storeLabel: ourStoreLabel,
        priceKind: "own",
      });
    } else {
      storeLabels.add(cellLabel);
      columns.push({
        week,
        department,
        columnIndex: c,
        ourStoreLabel,
        storeLabel: cellLabel,
        priceKind: "competitor",
      });
    }
  }

  // --- Товары и категории ---
  let currentCategory: string | null = null;
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = (row[0] ?? "").toString().trim();
    const barcodeRaw = row[1];
    const barcode = barcodeRaw === null || barcodeRaw === undefined ? "" : String(barcodeRaw).trim();

    if (!name) {
      continue;
    }

    // нет штрихкода → категория
    if (!barcode || barcode === "0") {
      currentCategory = name;
      continue;
    }

    products.push({
      barcode,
      name,
      department,
      category: currentCategory,
      rowIndex: r,
    });
  }

  // Дедупликация по штрихкоду: в шаблоне Яны встречаются полные дубликаты строк
  // (одинаковый штрихкод + одинаковое название). Оставляем первое вхождение.
  const seenBarcodes = new Set<string>();
  const deduped = products.filter((p) => {
    if (seenBarcodes.has(p.barcode)) {
      return false;
    }
    seenBarcodes.add(p.barcode);
    return true;
  });

  return { products: deduped, columns, storeLabels };
}

export function parseMonitoringTemplate(file: Buffer, week: 1 | 2): ParsedTemplate {
  const wb = XLSX.read(file, { type: "buffer" });
  const products: ParsedProduct[] = [];
  const columns: ParsedTemplateColumn[] = [];
  const storeLabelSet = new Set<string>();

  for (const sheetName of wb.SheetNames) {
    const department = SHEET_TO_DEPARTMENT[sheetName];
    if (!department) {
      continue;
    }
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      continue;
    }
    const parsed = parseSheet(ws, department, week);
    products.push(...parsed.products);
    columns.push(...parsed.columns);
    for (const label of parsed.storeLabels) {
      storeLabelSet.add(label);
    }
  }

  // --- Сторы: дедупликация по label + разделение наши/конкуренты ---
  const stores: ParsedStore[] = [];
  const seen = new Set<string>();
  // Сначала собираем "наши" ТТ (из ourStoreLabel), затем конкурентов.
  // isOwn определяется: магазин = наш, если есть колонка с priceKind=own и storeLabel=label.
  const ownLabels = new Set(
    columns.filter((col) => col.priceKind === "own").map((col) => col.storeLabel),
  );

  for (const label of storeLabelSet) {
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    const { name, address } = splitStoreLabel(label);
    stores.push({
      label,
      name,
      address,
      isOwn: ownLabels.has(label),
    });
  }

  return { products, stores, columns };
}
