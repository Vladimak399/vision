"use client";

import { useActionState } from "react";

import { importCatalogAction, type CatalogImportResult } from "../actions";

const initialState: CatalogImportResult = {
  processed: 0,
  created: 0,
  updated: 0,
  errors: [],
};

export function CatalogImportForm() {
  const [state, formAction, isPending] = useActionState(importCatalogAction, initialState);

  return (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", background: "#f8fafc" }}>
      <h2 style={{ marginTop: 0 }}>Загрузить файл</h2>
      <form action={formAction} style={{ display: "grid", gap: "1rem" }}>
        <input
          type="file"
          name="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          required
          style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "0.75rem", background: "white" }}
        />
        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: "0.75rem 1.5rem",
            background: isPending ? "#94a3b8" : "#0ea5e9",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: "1rem",
            fontWeight: 500,
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {isPending ? "Импортируем…" : "Импортировать каталог"}
        </button>
      </form>

      <div aria-live="polite" style={{ display: "grid", gap: "0.75rem", marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0 }}>Результат импорта</h3>
        <dl style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", margin: 0 }}>
          <div><dt style={{ color: "#64748b" }}>processed</dt><dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{state.processed}</dd></div>
          <div><dt style={{ color: "#64748b" }}>created</dt><dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{state.created}</dd></div>
          <div><dt style={{ color: "#64748b" }}>updated</dt><dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{state.updated}</dd></div>
          <div><dt style={{ color: "#64748b" }}>errors</dt><dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{state.errors.length}</dd></div>
        </dl>
        {state.errors.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#b45309" }}>
            {state.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
