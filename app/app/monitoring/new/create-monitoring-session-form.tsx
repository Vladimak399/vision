"use client";

import { useActionState } from "react";

import { createMonitoringSession, type MonitoringSessionCreateState } from "../actions";

type StoreOption = {
  id: string;
  name: string;
  address: string | null;
};

const initialState: MonitoringSessionCreateState = {};

export function CreateMonitoringSessionForm({ stores }: { stores: StoreOption[] }) {
  const [state, formAction, isPending] = useActionState(createMonitoringSession, initialState);

  return (
    <form
      action={formAction}
      style={{ border: "1px solid #d1d5db", borderRadius: 12, display: "grid", gap: "0.75rem", padding: "1rem" }}
    >
      <h2 style={{ margin: 0 }}>Новая сессия мониторинга</h2>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Магазин *</span>
        <select name="store_id" required defaultValue="">
          <option value="" disabled>
            Выберите магазин
          </option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}{store.address ? ` — ${store.address}` : ""}
            </option>
          ))}
        </select>
      </label>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      <button type="submit" disabled={isPending}>{isPending ? "Создание..." : "Создать сессию"}</button>
    </form>
  );
}
