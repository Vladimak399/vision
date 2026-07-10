"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  captureCompetitorPricesAction,
  type PriceCaptureResult,
  matchShelfItemsAction,
  type MatchShelfItemsResult,
} from "../../../server/price-capture";

type StoreOption = {
  id: string;
  name: string;
  address: string | null;
};

const initialState: PriceCaptureResult = {
  ok: false,
  week: 1,
  storeId: null,
  storeName: null,
  recognized: 0,
  saved: 0,
  errors: [],
};

const matchInitialState: MatchShelfItemsResult = {
  ok: false,
  week: 1,
  storeId: "",
  storeName: "",
  matched: 0,
  unmatched: 0,
  total: 0,
  errors: [],
};

export function PriceCaptureForm({ stores }: { stores: StoreOption[] }) {
  const [state, formAction, isPending] = useActionState(
    captureCompetitorPricesAction,
    initialState,
  );
  const [matchState, matchFormAction, isMatchPending] = useActionState(
    matchShelfItemsAction,
    matchInitialState,
  );
  const [submitted, setSubmitted] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [selectedWeek, setSelectedWeek] = useState<1 | 2>(1);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const submitLockedRef = useRef(false);
  const result = state ?? initialState;
  const matchResult = matchState ?? matchInitialState;
  const isSubmitting = isPending || submitted;

  // Фильтруем магазины по поисковому запросу
  const filteredStores = searchTerm.trim()
    ? stores.filter((s) =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.address && s.address.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    : stores;

  // Загружаем последний выбранный магазин из localStorage
  useEffect(() => {
    const lastStoreId = localStorage.getItem("lastStoreId");
    if (lastStoreId && stores.some((s) => s.id === lastStoreId)) {
      setSelectedStoreId(lastStoreId);
    }
  }, [stores]);

  // Сохраняем выбранный магазин в localStorage
  useEffect(() => {
    if (selectedStoreId) {
      localStorage.setItem("lastStoreId", selectedStoreId);
    }
  }, [selectedStoreId]);

  useEffect(() => {
    if (!isPending) {
      submitLockedRef.current = false;
      setSubmitted(false);
    }
  }, [isPending, state]);

  // Handle match form submission
  useEffect(() => {
    if (!isMatchPending && matchResult.ok) {
      // Match completed successfully
    }
  }, [isMatchPending, matchResult]);

  return (
    <>
      <section className="card soft">
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
                  defaultChecked
                  onChange={() => setSelectedWeek(1)}
                />
                Неделя 1
              </label>
              <label style={{ alignItems: "center", display: "flex", gap: "0.35rem" }}>
                <input
                  type="radio"
                  name="week"
                  value="2"
                  onChange={() => setSelectedWeek(2)}
                />
                Неделя 2
              </label>
            </div>
          </label>

          <label style={{ display: "grid", gap: "0.4rem" }}>
            <span style={{ fontWeight: 600 }}>Магазин-конкурент</span>
            <input
              type="text"
              placeholder="Поиск магазина..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: "0.5rem",
                fontSize: "1rem",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
              }}
            />
            <select
              name="storeId"
              required
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              style={{ marginTop: "0.5rem" }}
            >
              <option value="" disabled>
                Выберите магазин
              </option>
              {filteredStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.address ? `, ${s.address}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.4rem" }}>
            <span style={{ fontWeight: 600 }}>Фото полок</span>
            <input
              type="file"
              name="photos"
              accept="image/jpeg,image/png,image/webp"
              multiple
              required
            />
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              Можно выбрать несколько фото сразу. JPEG, PNG, WebP, до 10 МБ.
            </span>
          </label>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Распознаём…" : "Загрузить и распознать"}
          </button>
        </form>
      </section>

      {/* Match Form - for batch matching */}
      {selectedStoreId && result.saved > 0 && (
        <form
          action={matchFormAction}
          className="grid"
          style={{ marginTop: "1rem" }}
        >
          <input type="hidden" name="week" value={String(selectedWeek)} />
          <input type="hidden" name="storeId" value={selectedStoreId} />
          <button type="submit" disabled={isMatchPending}>
            {isMatchPending ? "Сопоставляем…" : "Сопоставить с каталогом"}
          </button>
        </form>
      )}

      <div aria-live="polite" className="grid" style={{ marginTop: "1.5rem" }}>
        {result.errors.length > 0 ? (
          <section className="card">
            <h3>Предупреждения / ошибки</h3>
            <ul className="alert alert-warn" style={{ margin: 0, paddingLeft: "1.25rem" }}>
              {result.errors.slice(0, 10).map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {result.recognized > 0 || result.ok ? (
          <section className="card soft">
            <h3>Результат распознавания</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {result.storeName ? `Магазин: ${result.storeName}. ` : ""}
              Неделя {result.week}.
            </p>
            <dl
              style={{
                display: "grid",
                gap: "0.5rem",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                margin: 0,
              }}
            >
              <div>
                <dt style={{ color: "#64748b" }}>Распознано</dt>
                <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
                  {result.recognized}
                </dd>
              </div>
              <div>
                <dt style={{ color: "#64748b" }}>Сохранено</dt>
                <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#16a34a" }}>
                  {result.saved}
                </dd>
              </div>
            </dl>
            {result.saved > 0 && result.storeId ? (
              <div className="alert alert-ok" style={{ marginTop: "1rem" }}>
                <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span>Товары сохранены в базе. Нажмите «Сопоставить с каталогом» для поиска совпадений.</span>
                  <Link
                    href={`/app/price-capture/${result.storeId}?week=${result.week}`}
                    style={{
                      padding: "0.5rem 1rem",
                      background: "#0ea5e9",
                      color: "white",
                      borderRadius: 6,
                      textDecoration: "none",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                    }}
                  >
                    Просмотреть товары магазина
                  </Link>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Match Result */}
        {matchResult.total > 0 && (
          <section className="card soft">
            <h3>Результат сопоставления</h3>
            <dl
              style={{
                display: "grid",
                gap: "0.5rem",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                margin: 0,
              }}
            >
              <div>
                <dt style={{ color: "#64748b" }}>Всего товаров</dt>
                <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
                  {matchResult.total}
                </dd>
              </div>
              <div>
                <dt style={{ color: "#64748b" }}>Сопоставлено</dt>
                <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#16a34a" }}>
                  {matchResult.matched}
                </dd>
              </div>
              <div>
                <dt style={{ color: "#64748b" }}>Не сопоставлено</dt>
                <dd style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#eab308" }}>
                  {matchResult.unmatched}
                </dd>
              </div>
            </dl>
            {matchResult.errors.length > 0 && (
              <ul className="alert alert-warn" style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                {matchResult.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}