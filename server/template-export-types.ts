/**
 * Типы отчёта preflight-экспорта.
 *
 * Выделены в отдельный модуль без server-импортов, чтобы их можно было
 * безопасно импортировать в client-компоненты (type-only import стирается
 * при сборке и не тянет exceljs/supabase в клиентский бандл).
 */

export type ExportPreflightMode = "latest" | "photo_only" | "online_only" | "online_preferred";

export type ExportPreflightStoreCoverage = {
  /** Исходная подпись колонки в шапке шаблона (имя + адрес). */
  storeLabel: string;
  /** Сопоставленный ID магазина или null, если колонка не разрешилась. */
  storeId: string | null;
  /** Колонка сопоставлена с магазином в БД. */
  resolved: boolean;
  /** Сколько ячеек цен будет заполнено для этого магазина. */
  filledPriceCells: number;
  /** Сколько ячеек цен в принципе заполняемы (товары из каталога). */
  totalProductRows: number;
  /** Покрытие цен в процентах (0-100). */
  coveragePct: number;
  /** Кол-во строк с low-confidence matching, которые попадут в файл. */
  lowConfidenceRows: number;
};

export type ExportPreflightLowConfidenceSample = {
  rawName: string;
  storeLabel: string;
  matchConfidence: number | null;
};

export type ExportPreflightReport = {
  ok: true;
  week: 1 | 2;
  mode: ExportPreflightMode;
  /** Всего колонок-конкурентов в шаблоне за неделю. */
  totalCompetitorColumns: number;
  /** Колонок, сопоставленных с магазином в БД. */
  resolvedStores: number;
  /** Колонок без сопоставления с магазином. */
  unresolvedColumns: number;
  /** Подписи колонок, которые не удалось сопоставить с магазином. */
  unresolvedColumnLabels: string[];
  /** Заполненных ячеек цен (по всем сопоставленным магазинам). */
  filledPriceCells: number;
  /** Заполняемых ячеек цен (товары из каталога × сопоставленные магазины). */
  totalPriceCells: number;
  /** Общее покрытие цен в процентах (0-100). */
  coveragePct: number;
  /** Товаров в шаблоне, чей штрихкод не найден в каталоге. */
  unmappedProductRows: number;
  /** Кол-во строк с low-confidence matching за неделю. */
  lowConfidenceRowCount: number;
  /** Примеры low-confidence строк (до 10). */
  lowConfidenceSamples: ExportPreflightLowConfidenceSample[];
  /** Покрытие по каждому магазину. */
  storeCoverage: ExportPreflightStoreCoverage[];
  /** Человекочитаемые предупреждения для пользователя. */
  warnings: string[];
};
