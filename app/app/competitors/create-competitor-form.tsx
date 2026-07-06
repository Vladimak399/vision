"use client";

import { useActionState } from "react";

import { createCompetitor, type CompetitorCreateState } from "./actions";

const initialState: CompetitorCreateState = {};

export function CreateCompetitorForm() {
  const [state, formAction, isPending] = useActionState(createCompetitor, initialState);

  return (
    <form action={formAction} style={{ border: "1px solid #d1d5db", borderRadius: 12, display: "grid", gap: "0.75rem", padding: "1rem" }}>
      <h2 style={{ margin: 0 }}>Добавить конкурента</h2>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Название *</span>
        <input name="name" required maxLength={200} />
      </label>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      <button type="submit" disabled={isPending}>{isPending ? "Сохранение..." : "Создать конкурента"}</button>
    </form>
  );
}
