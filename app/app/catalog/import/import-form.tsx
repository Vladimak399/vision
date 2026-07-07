"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { importCatalogAction, type CatalogImportResult } from "../actions";

const initialState: CatalogImportResult = {
  processed: 0,
  created: 0,
  updated: 0,
  errors: [],
};

export function CatalogImportForm() {
  const [state, formAction, isPending] = useActionState(importCatalogAction, initialState);
  const [submitted, setSubmitted] = useState(false);
  const submitLockedRef = useRef(false);
  const result = state ?? initialState;
  const isSubmitting = isPending || submitted;

  useEffect(() => {
    if (!isPending) {
      submitLockedRef.current = false;
      setSubmitted(false);
    }
  }, [isPending, state]);

  return (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", background: "#f8fafc" }}>
      <h2 style={{ marginTop: 0 }}>Загрузить файл</h2>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (submitLockedRef.current || isSubmitting) {
            event.preventDefault();
            return;
          }
          submitLockedRef.current = true;
          setSubmitted(true);
        }}
        style={{ display: "grid", gap: "1rem" }}
      >
        <input
          type="file"
          name="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          required
          style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "0.75rem", background: "white" }}
        />
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            padding: "0.75rem 1.5rem",
            background: isSubmitting ? "#94a3b8" : "#0ea5e9",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: "1rem",
            fontWeight: 500,
            cursor: isSubmitting ? "not-allowed" : "pointer",
          }}
        >
          {isSubmitting ? "Импортируем…" : "Импортировать каталог"}
        </button>
      </form>

      <div aria-live="polite" style={{ display: "grid", gap: "0.75rem", marginTop: "1.5rem" }}>
        <h3 style={{ margin: 0 }}>Результат импорта</h3>
        <dl style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", margin: 0 }}>
          <div><dt style={{ color: "#64748b" }}>processed</dt><dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{result.processed}</dd></div>
          <div><dt style={{ color: "#64748b" }}>created</dt><dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{result.created}</dd></div>
          <div><dt style={{ color: "#64748b" }}>updated</dt><dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{result.updated}</dd></div>
          <div><dt style={{ color: "#64748b" }}>errors</dt><dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>{result.errors.length}</dd></div>
        </dl>
        {result.errors.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#b45309" }}>
            {result.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
