"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { importMonitoringTemplateAction, type TemplateImportResult } from "../../../server/template-import";

const initialState: TemplateImportResult = {
  ok: false,
  week: 1,
  products: 0,
  stores: 0,
  ownStores: 0,
  competitorStores: 0,
  errors: [],
};

export function TemplateImportForm() {
  const [state, formAction, isPending] = useActionState(
    importMonitoringTemplateAction,
    initialState,
  );
  const [submitted, setSubmitted] = useState(false);
  const [week, setWeek] = useState<1 | 2>(1);
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
      <h2>Загрузить шаблон мониторинга</h2>
      <p className="lead">
        Файл Excel от Яны с двумя листами (Химия и Продукты). Приложение прочитает
        товары, ваши магазины и конкурентов, а также связи колонок.
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
        <label style={{ display: "grid", gap: "0.4rem" }}>
          <span style={{ fontWeight: 600 }}>Неделя</span>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <label style={{ alignItems: "center", display: "flex", gap: "0.35rem" }}>
              <input
                type="radio"
                name="week"
                value="1"
                checked={week === 1}
                onChange={() => setWeek(1)}
              />
              Неделя 1
            </label>
            <label style={{ alignItems: "center", display: "flex", gap: "0.35rem" }}>
              <input
                type="radio"
                name="week"
                value="2"
                checked={week === 2}
                onChange={() => setWeek(2)}
              />
              Неделя 2
            </label>
          </div>
        </label>

        <input
          type="file"
          name="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          required
        />
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Импортируем…" : "Импортировать шаблон"}
        </button>
      </form>

      <div aria-live="polite" className="grid" style={{ marginTop: "1.5rem" }}>
        <h3>Результат импорта</h3>
        <dl
          style={{
            display: "grid",
            gap: "0.5rem",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            margin: 0,
          }}
        >
          <div>
            <dt style={{ color: "#64748b" }}>Товаров</dt>
            <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
              {result.products}
            </dd>
          </div>
          <div>
            <dt style={{ color: "#64748b" }}>Наших ТТ</dt>
            <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
              {result.ownStores}
            </dd>
          </div>
          <div>
            <dt style={{ color: "#64748b" }}>Конкурентов</dt>
            <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
              {result.competitorStores}
            </dd>
          </div>
        </dl>
        {result.errors.length > 0 ? (
          <ul className="alert alert-warn" style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {result.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : result.ok ? (
          <div className="alert alert-ok">
            Шаблон недели {result.week} загружен. {result.products} товаров,{" "}
            {result.ownStores} наших точек и {result.competitorStores} конкурентов.
          </div>
        ) : (
          <div className="empty">
            <strong>Результат появится после загрузки</strong>
            <span className="muted">
              Выберите неделю и файл Excel. Если что-то пойдёт не так — покажем ошибку.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
