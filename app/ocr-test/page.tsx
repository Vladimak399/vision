"use client";

import Link from "next/link";
import { ChangeEvent, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type OcrResult = {
  provider?: string;
  mode?: string;
  model?: string;
  fallbackUsed?: boolean;
  raw?: string;
  parsed?: unknown;
  usage?: unknown;
  error?: string;
  details?: string[];
};

type CatalogItem = {
  rowNumber: number;
  name: string;
  price: number | null;
  sku: string;
  barcode: string;
};

type MatchResult = {
  item: CatalogItem;
  score: number;
};

type ComparisonStatus = "competitor_cheaper" | "competitor_more_expensive" | "about_equal" | "needs_review";

type ComparedRow = {
  index: number;
  status: ComparisonStatus;
  competitorName: string;
  competitorPrice: number | null;
  rawText: string;
  weightOrVolume: string;
  promo: boolean;
  ocrConfidence: number | null;
  match: MatchResult | null;
  differenceRub: number | null;
  differencePercent: number | null;
  warnings: string[];
};

const modelOptions = [
  {
    value: "nvidia/nemotron-nano-12b-v2-vl:free",
    label: "NVIDIA Nemotron Nano VL free",
  },
  {
    value: "qwen/qwen2.5-vl-72b-instruct",
    label: "Qwen2.5-VL 72B",
  },
  {
    value: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
  },
];

const statusMeta: Record<ComparisonStatus, { label: string; badgeClass: string }> = {
  competitor_cheaper: { label: "Конкурент дешевле", badgeClass: "badge-bad" },
  competitor_more_expensive: { label: "Конкурент дороже", badgeClass: "badge-ok" },
  about_equal: { label: "Примерно равно", badgeClass: "badge-neutral" },
  needs_review: { label: "Проверить руками", badgeClass: "badge-warn" },
};

const stopWords = new Set([
  "цена",
  "руб",
  "рубль",
  "рублей",
  "р",
  "акция",
  "скидка",
  "товар",
  "шт",
  "для",
  "или",
  "при",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = toText(value).replace(/\s+/g, "").replace(",", ".");
  const parsed = Number.parseFloat(text);

  return Number.isFinite(parsed) ? parsed : null;
}

function parsePrice(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = toText(value)
    .replace(/\u00a0/g, " ")
    .replace(/₽|руб\.?|р\./gi, " ")
    .trim();

  if (!text) {
    return null;
  }

  const compact = text.replace(/\s+/g, "").replace(/,/g, ".");
  const matches = compact.match(/\d+(?:\.\d{1,2})?/g);

  if (!matches?.length) {
    return null;
  }

  const parsed = Number.parseFloat(matches[0]);

  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "не найдено";
  }

  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ₽`;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "не найдено";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9,.\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalize(value)
    .replace(/,/g, ".")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function extractWeight(value: string) {
  const match = normalize(value).match(/(\d+(?:[.,]\d+)?)\s*(кг|г|гр|мл|л)\b/);

  if (!match) {
    return "";
  }

  const amount = match[1].replace(",", ".");
  const unit = match[2] === "гр" ? "г" : match[2];

  return `${amount}${unit}`;
}

function scoreCatalogMatch(query: string, catalogName: string) {
  const normalizedQuery = normalize(query);
  const normalizedCatalog = normalize(catalogName);

  if (!normalizedQuery || !normalizedCatalog) {
    return 0;
  }

  if (normalizedCatalog.includes(normalizedQuery) || normalizedQuery.includes(normalizedCatalog)) {
    return 0.95;
  }

  const queryTokens = tokenize(normalizedQuery);
  const catalogTokens = tokenize(normalizedCatalog);

  if (!queryTokens.length || !catalogTokens.length) {
    return 0;
  }

  const catalogSet = new Set(catalogTokens);
  const common = queryTokens.filter((token) => catalogSet.has(token));
  const precision = common.length / queryTokens.length;
  const recall = common.length / catalogTokens.length;
  let score = precision * 0.7 + recall * 0.3;

  const queryWeight = extractWeight(normalizedQuery);
  const catalogWeight = extractWeight(normalizedCatalog);

  if (queryWeight && catalogWeight && queryWeight === catalogWeight) {
    score += 0.12;
  }

  if (queryWeight && catalogWeight && queryWeight !== catalogWeight) {
    score -= 0.16;
  }

  return Math.max(0, Math.min(1, score));
}

function findBestCatalogMatch(query: string, catalogItems: CatalogItem[]): MatchResult | null {
  let best: MatchResult | null = null;

  for (const item of catalogItems) {
    const score = scoreCatalogMatch(query, item.name);

    if (!best || score > best.score) {
      best = { item, score };
    }
  }

  if (!best || best.score < 0.35) {
    return null;
  }

  return best;
}

function detectCatalogColumns(headers: string[]) {
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalize(header) }));

  const nameColumn = normalizedHeaders.find(({ normalized }) =>
    ["номенклатура", "наименование", "название", "товар", "product", "name"].some((candidate) =>
      normalized.includes(candidate),
    ),
  )?.header;

  const priceColumn = normalizedHeaders.find(({ normalized }) => {
    const isBadPrice = ["закуп", "себестоим", "опт", "вход"].some((candidate) => normalized.includes(candidate));
    const isGoodPrice = ["розн", "продаж", "цена", "price", "retail"].some((candidate) =>
      normalized.includes(candidate),
    );

    return isGoodPrice && !isBadPrice;
  })?.header;

  const skuColumn = normalizedHeaders.find(({ normalized }) =>
    ["артикул", "sku", "код"].some((candidate) => normalized.includes(candidate)),
  )?.header;

  const barcodeColumn = normalizedHeaders.find(({ normalized }) =>
    ["штрих", "barcode", "ean"].some((candidate) => normalized.includes(candidate)),
  )?.header;

  return { nameColumn, priceColumn, skuColumn, barcodeColumn };
}

async function readCatalogFile(file: File) {
  const workbook = /\.(csv|txt)$/i.test(file.name)
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("В файле каталога не найден лист с данными.");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (!rows.length) {
    throw new Error("Каталог пустой или не прочитан.");
  }

  const headers = Object.keys(rows[0] || {});
  const { nameColumn, priceColumn, skuColumn, barcodeColumn } = detectCatalogColumns(headers);

  if (!nameColumn || !priceColumn) {
    throw new Error("Не нашел в каталоге колонки с названием товара и ценой. Нужны колонки вроде Номенклатура/Наименование и Цена/Розница.");
  }

  const items = rows
    .map((row, index) => ({
      rowNumber: index + 2,
      name: toText(row[nameColumn]),
      price: parsePrice(row[priceColumn]),
      sku: skuColumn ? toText(row[skuColumn]) : "",
      barcode: barcodeColumn ? toText(row[barcodeColumn]) : "",
    }))
    .filter((item) => item.name && item.price !== null);

  if (!items.length) {
    throw new Error("В каталоге не найдено строк, где есть и название, и цена.");
  }

  return items;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Не удалось прочитать фото."));
    };

    reader.onerror = () => reject(new Error("Не удалось прочитать фото."));
    reader.readAsDataURL(file);
  });
}

function getOcrItems(parsed: unknown): Record<string, unknown>[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
    return [];
  }

  return parsed.items.filter(isRecord);
}

function getOcrName(item: Record<string, unknown>) {
  return toText(item.competitor_product_name) || toText(item.possible_product_name);
}

function getOcrPrice(item: Record<string, unknown>) {
  return parsePrice(item.competitor_price) ?? parsePrice(item.price) ?? parsePrice(item.raw_price_text);
}

function getWarnings(item: Record<string, unknown>) {
  return Array.isArray(item.warnings) ? item.warnings.map(toText).filter(Boolean) : [];
}

function compareOcrWithCatalog(result: OcrResult | null, catalogItems: CatalogItem[]) {
  const ocrItems = getOcrItems(result?.parsed);

  return ocrItems.map<ComparedRow>((item, index) => {
    const competitorName = getOcrName(item);
    const rawText = toText(item.raw_text);
    const weightOrVolume = toText(item.weight_or_volume);
    const competitorPrice = getOcrPrice(item);
    const query = [competitorName, rawText, weightOrVolume].filter(Boolean).join(" ");
    const match = findBestCatalogMatch(query, catalogItems);
    const ourPrice = match?.item.price ?? null;
    const differenceRub = competitorPrice !== null && ourPrice !== null ? roundMoney(competitorPrice - ourPrice) : null;
    const differencePercent = differenceRub !== null && ourPrice ? roundMoney((differenceRub / ourPrice) * 100) : null;
    const ocrConfidence = parseNumber(item.ocr_confidence) ?? parseNumber(item.confidence);
    const warnings = getWarnings(item);
    const needsReview =
      competitorPrice === null ||
      ourPrice === null ||
      !match ||
      match.score < 0.62 ||
      (ocrConfidence !== null && ocrConfidence > 0 && ocrConfidence < 0.65);

    let status: ComparisonStatus = "needs_review";

    if (!needsReview && differenceRub !== null && differencePercent !== null) {
      if (Math.abs(differenceRub) <= 1 || Math.abs(differencePercent) <= 1) {
        status = "about_equal";
      } else if (differenceRub < 0) {
        status = "competitor_cheaper";
      } else {
        status = "competitor_more_expensive";
      }
    }

    return {
      index,
      status,
      competitorName,
      competitorPrice,
      rawText,
      weightOrVolume,
      promo: Boolean(item.promo),
      ocrConfidence,
      match,
      differenceRub,
      differencePercent,
      warnings,
    };
  });
}

function formatMatchScore(match: MatchResult | null) {
  if (!match) {
    return "не найдено";
  }

  return `${Math.round(match.score * 100)}%`;
}

function buildSummary(rows: ComparedRow[]) {
  return {
    competitorCheaper: rows.filter((row) => row.status === "competitor_cheaper").length,
    competitorMoreExpensive: rows.filter((row) => row.status === "competitor_more_expensive").length,
    aboutEqual: rows.filter((row) => row.status === "about_equal").length,
    needsReview: rows.filter((row) => row.status === "needs_review").length,
  };
}

export default function OcrTestPage() {
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const [photoFileName, setPhotoFileName] = useState("");
  const [catalogFileName, setCatalogFileName] = useState("");
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [competitorName, setCompetitorName] = useState("Конкурент");
  const [model, setModel] = useState(modelOptions[0].value);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const comparedRows = useMemo(() => compareOcrWithCatalog(result, catalogItems), [result, catalogItems]);
  const summary = useMemo(() => buildSummary(comparedRows), [comparedRows]);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setError("");
    setResult(null);

    if (!file) {
      setImageDataUrl("");
      setPhotoFileName("");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Выбери фото в формате JPG, PNG или WEBP.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("Фото тяжелее 8 МБ. Сожми его или выбери другое.");
      return;
    }

    try {
      setPhotoFileName(file.name);
      setImageDataUrl(await readFileAsDataUrl(file));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Не удалось прочитать фото.");
    }
  }

  async function handleCatalogChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setCatalogError("");
    setCatalogItems([]);
    setResult(null);

    if (!file) {
      setCatalogFileName("");
      return;
    }

    try {
      const items = await readCatalogFile(file);
      setCatalogFileName(file.name);
      setCatalogItems(items);
    } catch (readError) {
      setCatalogError(readError instanceof Error ? readError.message : "Не удалось прочитать каталог.");
    }
  }

  async function runComparison() {
    if (!imageDataUrl) {
      setError("Сначала выбери фото полки конкурента.");
      return;
    }

    if (!catalogItems.length) {
      setCatalogError("Сначала загрузи наш каталог с названием товара и нашей ценой.");
      return;
    }

    setIsLoading(true);
    setError("");
    setCatalogError("");
    setResult(null);

    try {
      const response = await fetch("/api/ocr/openrouter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageDataUrl,
          model,
        }),
      });

      const payload = (await response.json()) as OcrResult;

      if (!response.ok) {
        setError(payload.error || "OpenRouter OCR вернул ошибку.");
        setResult(payload);
        return;
      }

      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось отправить фото на OCR.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="hero-panel">
        <div className="hero" style={{ position: "relative", zIndex: 1 }}>
          <div>
            <p className="eyebrow">OpenRouter OCR · competitor prices</p>
            <h1>Сравнение цен конкурента по фото</h1>
            <p className="lead">
              Загрузи фото полки конкурента и наш каталог с ценами. Система вытащит цены с ценников,
              сопоставит их с нашими товарами и покажет, где конкурент дешевле или дороже.
            </p>
          </div>
          <div className="actions">
            <Link className="btn btn-secondary" href="/">
              На главную
            </Link>
            <Link className="btn btn-secondary" href="/app">
              Открыть приложение
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card">
          <p className="eyebrow">Входные данные</p>
          <h2>Фото конкурента и наш каталог</h2>
          <p className="muted">
            OpenRouter получает только фото. Каталог с нашими ценами сравнивается в браузере и не уходит во внешнюю модель.
          </p>

          <label className="field" style={{ marginTop: "1rem" }}>
            Название конкурента
            <input value={competitorName} onChange={(event) => setCompetitorName(event.target.value)} />
          </label>

          <label className="field" style={{ marginTop: "1rem" }}>
            Модель OCR
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field" style={{ marginTop: "1rem" }}>
            Наш каталог или прайс
            <input accept=".xlsx,.xls,.csv,.txt" type="file" onChange={handleCatalogChange} />
          </label>

          {catalogFileName ? (
            <div className="alert alert-ok" style={{ marginTop: "1rem" }}>
              Загружено: <b>{catalogFileName}</b>. Товаров с ценой: <b>{catalogItems.length}</b>.
            </div>
          ) : null}

          {catalogError ? (
            <div className="alert alert-bad" style={{ marginTop: "1rem" }}>
              {catalogError}
            </div>
          ) : null}

          <label className="field" style={{ marginTop: "1rem" }}>
            Фото полки конкурента
            <input accept="image/png,image/jpeg,image/webp" type="file" onChange={handlePhotoChange} />
          </label>

          {photoFileName ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              Фото: <b>{photoFileName}</b>
            </p>
          ) : null}

          {imageDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Фото конкурента для сравнения цен"
              src={imageDataUrl}
              style={{
                width: "100%",
                maxHeight: "420px",
                objectFit: "contain",
                borderRadius: "18px",
                border: "1px solid var(--border)",
                marginTop: "1rem",
                background: "#fff",
              }}
            />
          ) : (
            <div className="empty" style={{ marginTop: "1rem" }}>
              <b>Фото пока не выбрано</b>
              <span className="muted">Можно загрузить обычный снимок полки с телефона.</span>
            </div>
          )}

          {error ? (
            <div className="alert alert-bad" style={{ marginTop: "1rem" }}>
              {error}
            </div>
          ) : null}

          <div className="actions" style={{ marginTop: "1rem" }}>
            <button disabled={isLoading || !imageDataUrl || !catalogItems.length} type="button" onClick={runComparison}>
              {isLoading ? "Сравниваю..." : "Сравнить цены конкурента"}
            </button>
          </div>
        </div>

        <div className="card soft">
          <p className="eyebrow">Итог</p>
          <h2>{competitorName || "Конкурент"}: дороже или дешевле</h2>

          {!result ? (
            <div className="empty" style={{ marginTop: "1rem" }}>
              <b>Результат появится здесь</b>
              <span className="muted">
                Для первого теста лучше взять фото, где на ценниках видны цена, название и вес/объем.
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
              <div className="pill-row">
                <span className="badge badge-info">{result.provider || "openrouter"}</span>
                <span className="badge badge-neutral">{result.model || model}</span>
                {result.fallbackUsed ? <span className="badge badge-warn">fallback</span> : null}
              </div>

              <div className="stats">
                <div className="stat">
                  <b>{summary.competitorCheaper}</b>
                  <p className="muted" style={{ marginBottom: 0 }}>конкурент дешевле</p>
                </div>
                <div className="stat">
                  <b>{summary.competitorMoreExpensive}</b>
                  <p className="muted" style={{ marginBottom: 0 }}>конкурент дороже</p>
                </div>
                <div className="stat">
                  <b>{summary.aboutEqual}</b>
                  <p className="muted" style={{ marginBottom: 0 }}>примерно равно</p>
                </div>
                <div className="stat">
                  <b>{summary.needsReview}</b>
                  <p className="muted" style={{ marginBottom: 0 }}>на проверку</p>
                </div>
              </div>

              {comparedRows.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Статус</th>
                        <th>Ценник конкурента</th>
                        <th>Наш товар</th>
                        <th>Цена конкурента</th>
                        <th>Наша цена</th>
                        <th>Разница</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparedRows.map((row) => {
                        const meta = statusMeta[row.status];
                        const ourPrice = row.match?.item.price ?? null;

                        return (
                          <tr key={`${row.rawText}-${row.index}`}>
                            <td>
                              <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>
                              <br />
                              <span className="muted">match: {formatMatchScore(row.match)}</span>
                            </td>
                            <td>
                              <b>{row.competitorName || "название не прочитано"}</b>
                              <br />
                              <span className="muted">{row.rawText || "сырой текст не вернулся"}</span>
                              {row.weightOrVolume ? (
                                <>
                                  <br />
                                  <span className="muted">{row.weightOrVolume}</span>
                                </>
                              ) : null}
                              {row.promo ? (
                                <>
                                  <br />
                                  <span className="badge badge-info">акция</span>
                                </>
                              ) : null}
                            </td>
                            <td>
                              <b>{row.match?.item.name || "не найден"}</b>
                              {row.match?.item.sku ? (
                                <>
                                  <br />
                                  <span className="muted">код: {row.match.item.sku}</span>
                                </>
                              ) : null}
                              {row.warnings.length ? (
                                <>
                                  <br />
                                  <span className="muted">{row.warnings.join(", ")}</span>
                                </>
                              ) : null}
                            </td>
                            <td><b>{formatMoney(row.competitorPrice)}</b></td>
                            <td>{formatMoney(ourPrice)}</td>
                            <td>
                              <b>{formatMoney(row.differenceRub)}</b>
                              <br />
                              <span className="muted">{formatPercent(row.differencePercent)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="alert alert-warn">
                  OCR не вернул список items. Ниже оставлен сырой ответ модели.
                </div>
              )}

              <textarea
                readOnly
                value={JSON.stringify(result.parsed ?? result.raw ?? result, null, 2)}
                style={{
                  width: "100%",
                  minHeight: "260px",
                  border: "1px solid var(--border)",
                  borderRadius: "18px",
                  padding: "1rem",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: ".88rem",
                  lineHeight: 1.55,
                  resize: "vertical",
                  background: "#fff",
                  color: "var(--text)",
                }}
              />
            </div>
          )}
        </div>
      </section>

      <section className="alert alert-warn">
        Это тест сравнения цен, а не финальный отчет. Строки с низким совпадением товара, слабым OCR или странной ценой уходят в ручную проверку.
      </section>
    </main>
  );
}
