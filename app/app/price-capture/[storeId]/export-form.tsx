"use client";

import { useState } from "react";

import type { ExportPreflightReport } from "../../../../server/template-export-types";

type ExportFormProps = {
  week: 1 | 2;
};

function getFilenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) {
    return fallback;
  }

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/["']/g, ""));
  }

  const asciiMatch = header.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] ?? fallback;
}

function coverageColor(pct: number): string {
  if (pct >= 80) return "#16a34a";
  if (pct >= 50) return "#eab308";
  return "#dc2626";
}

export function ExportForm({ week }: ExportFormProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [isPreflighting, setIsPreflighting] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<ExportPreflightReport | null>(null);

  async function handlePreflight(formData: FormData) {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setPreflightError("Выберите XLSX файл шаблона");
      return;
    }

    setIsPreflighting(true);
    setPreflightError(null);
    setPreflight(null);

    try {
      const selectedWeek = formData.get("week") === "2" ? "2" : "1";
      const preflightFormData = new FormData();
      preflightFormData.append("file", file);
      preflightFormData.append("week", selectedWeek);

      const response = await fetch("/app/price-capture/export/preflight", {
        method: "POST",
        body: preflightFormData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setPreflightError(errorData.error || "Ошибка проверки");
        return;
      }

      setPreflight((await response.json()) as ExportPreflightReport);
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : "Неизвестная ошибка");
    } finally {
      setIsPreflighting(false);
    }
  }

  async function handleSubmit(formData: FormData) {
    setIsExporting(true);
    setExportError(null);

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setExportError("Выберите XLSX файл шаблона");
      setIsExporting(false);
      return;
    }

    try {
      const selectedWeek = formData.get("week") === "2" ? "2" : "1";
      const exportFormData = new FormData();
      exportFormData.append("file", file);
      exportFormData.append("week", selectedWeek);

      const response = await fetch("/app/price-capture/export", {
        method: "POST",
        body: exportFormData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setExportError(errorData.error || "Ошибка экспорта");
        setIsExporting(false);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getFilenameFromDisposition(
        response.headers.get("Content-Disposition"),
        `monitoring-week${selectedWeek}-filled.xlsx`,
      );
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Неизвестная ошибка");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="card soft">
      <h2>Выгрузить Excel</h2>
      <form action={handleSubmit} className="grid" style={{ marginTop: "1rem" }}>
        <label className="field">
          <span>Неделя</span>
          <select name="week" defaultValue={String(week)} disabled={isExporting || isPreflighting}>
            <option value="1">Неделя 1</option>
            <option value="2">Неделя 2</option>
          </select>
        </label>
        <label className="field">
          <span>Шаблон Яны</span>
          <input
            type="file"
            name="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            required
            disabled={isExporting || isPreflighting}
            onChange={() => {
              // Сбрасываем предыдущий отчёт при смене файла
              setPreflight(null);
              setPreflightError(null);
            }}
          />
        </label>
        <div className="actions" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={isPreflighting || isExporting}
            onClick={(e) => {
              const form = e.currentTarget.closest("form");
              if (form) handlePreflight(new FormData(form));
            }}
          >
            {isPreflighting ? "Проверяем…" : "Проверить покрытие"}
          </button>
          <button type="submit" disabled={isExporting || isPreflighting}>
            {isExporting ? "Выгружаем..." : "Выгрузить Excel с ценами"}
          </button>
        </div>
      </form>

      {exportError && (
        <div className="alert alert-bad" style={{ marginTop: "1rem" }}>
          {exportError}
        </div>
      )}

      {preflightError && (
        <div className="alert alert-bad" style={{ marginTop: "1rem" }}>
          {preflightError}
        </div>
      )}

      {preflight && (
        <div style={{ marginTop: "1.25rem", display: "grid", gap: "1rem" }}>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0 }}>Проверка перед выгрузкой — Неделя {preflight.week}</h3>
            <span
              style={{
                fontWeight: 700,
                fontSize: "1.25rem",
                color: coverageColor(preflight.coveragePct),
              }}
            >
              Покрытие цен: {preflight.coveragePct}%
            </span>
          </div>

          <dl
            style={{
              display: "grid",
              gap: "0.5rem",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              margin: 0,
            }}
          >
            <div>
              <dt style={{ color: "#64748b" }}>Заполнено ячеек</dt>
              <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
                {preflight.filledPriceCells}
                <span style={{ color: "#94a3b8", fontSize: "1rem" }}>
                  {" "}
                  / {preflight.totalPriceCells}
                </span>
              </dd>
            </div>
            <div>
              <dt style={{ color: "#64748b" }}>Магазины сопоставлены</dt>
              <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
                {preflight.resolvedStores}
                <span style={{ color: "#94a3b8", fontSize: "1rem" }}>
                  {" "}
                  / {preflight.totalCompetitorColumns}
                </span>
              </dd>
            </div>
            <div>
              <dt style={{ color: "#64748b" }}>Low-confidence</dt>
              <dd
                style={{
                  margin: 0,
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: preflight.lowConfidenceRowCount > 0 ? "#eab308" : "#16a34a",
                }}
              >
                {preflight.lowConfidenceRowCount}
              </dd>
            </div>
          </dl>

          {preflight.warnings.length > 0 && (
            <ul
              className="alert alert-warn"
              style={{ margin: 0, paddingLeft: "1.25rem" }}
            >
              {preflight.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}

          {preflight.unresolvedColumns > 0 && (
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              Колонки без магазина:{" "}
              {preflight.unresolvedColumnLabels.join(", ") || "—"}
            </p>
          )}

          {preflight.storeCoverage.length > 0 && (
            <div>
              <h4 style={{ margin: "0 0 0.5rem" }}>Покрытие по магазинам</h4>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
                {preflight.storeCoverage.map((store) => (
                  <li
                    key={store.storeLabel}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      padding: "0.5rem 0.75rem",
                      opacity: store.resolved ? 1 : 0.7,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        fontSize: "0.9rem",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{store.storeLabel}</span>
                      <span style={{ color: coverageColor(store.coveragePct), fontWeight: 600 }}>
                        {store.coveragePct}%
                        {!store.resolved && " (нет магазина)"}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: "0.35rem",
                        height: 6,
                        background: "#f1f5f9",
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${store.coveragePct}%`,
                          height: "100%",
                          background: coverageColor(store.coveragePct),
                        }}
                      />
                    </div>
                    <div
                      style={{
                        marginTop: "0.25rem",
                        fontSize: "0.78rem",
                        color: "#64748b",
                      }}
                    >
                      Заполнено {store.filledPriceCells} из {store.totalProductRows}
                      {store.lowConfidenceRows > 0
                        ? ` · low-confidence: ${store.lowConfidenceRows}`
                        : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preflight.lowConfidenceSamples.length > 0 && (
            <div>
              <h4 style={{ margin: "0 0 0.5rem" }}>
                Примеры low-confidence товаров
              </h4>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem" }}>
                {preflight.lowConfidenceSamples.map((sample, i) => (
                  <li key={i}>
                    <strong>{sample.rawName}</strong>{" "}
                    <span className="muted">
                      ({sample.storeLabel}
                      {sample.matchConfidence !== null
                        ? `, уверенность ${Math.round(sample.matchConfidence * 100)}%`
                        : ", без уверенности"}
                      )
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
