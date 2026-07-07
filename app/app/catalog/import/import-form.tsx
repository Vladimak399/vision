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
  const [state, formAction, isPending] = useActionState(
    importCatalogAction,
    initialState,
  );
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
    <section className="card soft">
      <h2>Загрузить файл ассортимента</h2>
      <p className="lead">
        Поддерживаются CSV, XLSX и XLS. Обязательные колонки: SKU и название.
        После импорта товары сразу доступны в review.
      </p>
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
        className="grid"
      >
        <input
          type="file"
          name="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          required
        />
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Импортируем…" : "Импортировать каталог"}
        </button>
      </form>

      <div aria-live="polite" className="grid" style={{ marginTop: "1.5rem" }}>
        <h3>Результат импорта</h3>
        <dl
          style={{
            display: "grid",
            gap: "0.5rem",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            margin: 0,
          }}
        >
          <div>
            <dt style={{ color: "#64748b" }}>Обработано</dt>
            <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
              {result.processed}
            </dd>
          </div>
          <div>
            <dt style={{ color: "#64748b" }}>Создано</dt>
            <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
              {result.created}
            </dd>
          </div>
          <div>
            <dt style={{ color: "#64748b" }}>Обновлено</dt>
            <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
              {result.updated}
            </dd>
          </div>
          <div>
            <dt style={{ color: "#64748b" }}>Ошибки</dt>
            <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
              {result.errors.length}
            </dd>
          </div>
        </dl>
        {result.errors.length > 0 ? (
          <ul
            className="alert alert-warn"
            style={{ margin: 0, paddingLeft: "1.25rem" }}
          >
            {result.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : result.processed > 0 ? (
          <div className="alert alert-ok">
            Импорт завершён. Следующий шаг — открыть каталог или создать сессию
            мониторинга.
          </div>
        ) : (
          <div className="empty">
            <strong>Результат появится после загрузки</strong>
            <span className="muted">
              Если в файле будут ошибки строк, мы покажем их списком здесь.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
