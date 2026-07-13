import Excel from "exceljs";

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
function buildColumnToOwnStore(worksheet: Excel.Worksheet): Map<number, string> {
  const map = new Map<number, string>();

  for (let column = 3; column <= worksheet.columnCount; column += 1) {
    const label = cellText(worksheet.getCell(1, column).value);
    if (label) map.set(column - 1, label);
  }

  return map;
}

function parseSheet(
  worksheet: Excel.Worksheet,
  department: Department,
  week: 1 | 2,
): { products: ParsedProduct[]; columns: ParsedTemplateColumn[]; storeLabels: Set<string> } {
  const columnToOwnStore = buildColumnToOwnStore(worksheet);

  const products: ParsedProduct[] = [];
  const storeLabels = new Set<string>();
  const columns: ParsedTemplateColumn[] = [];

  // --- Колонки: проходим по row1, пропускаем 0-1 ---
  for (let c = 2; c < worksheet.columnCount; c++) {
    const cellLabel = cellText(worksheet.getCell(2, c + 1).value);
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
  for (let r = 2; r < worksheet.rowCount; r++) {
    const name = cellText(worksheet.getCell(r + 1, 1).value);
    const barcode = cellText(worksheet.getCell(r + 1, 2).value);

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

export async function parseMonitoringTemplate(file: Buffer, week: 1 | 2): Promise<ParsedTemplate> {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(file as unknown as ArrayBuffer);
  const products: ParsedProduct[] = [];
  const columns: ParsedTemplateColumn[] = [];
  const storeLabelSet = new Set<string>();

  for (const worksheet of workbook.worksheets) {
    const department = SHEET_TO_DEPARTMENT[worksheet.name];
    if (!department) {
      continue;
    }
    const parsed = parseSheet(worksheet, department, week);
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

function cellText(value: Excel.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as Excel.CellValue);
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
    return "";
  }
  return String(value).trim().replace(/\.0$/, "");
}
