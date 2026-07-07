"use client";

import { useActionState } from "react";

import { acceptHighConfidenceMatchesForSession, suggestCatalogMatchesForSession, type MatchActionState } from "./match-actions";

const initialState: MatchActionState = {};

export function MatchControls({ sessionId, department }: { sessionId: string; department: string }) {
  const [state, formAction, isPending] = useActionState(suggestCatalogMatchesForSession, initialState);
  const [acceptState, acceptAction, isAcceptPending] = useActionState(acceptHighConfidenceMatchesForSession, initialState);

  return (
    <form action={formAction} style={{ border: "1px solid #d1d5db", borderRadius: 12, display: "grid", gap: "0.5rem", padding: "1rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      {department !== "all" ? <input type="hidden" name="department" value={department} /> : null}
      <strong>Автоподбор из каталога</strong>
      <p style={{ color: "#4b5563", margin: 0 }}>Подбирает кандидатов из catalog_products по текущему фильтру. Низкая уверенность останется на ручную проверку.</p>
      <button type="submit" disabled={isPending}>{isPending ? "Подбираем..." : "Подобрать кандидатов"}</button>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      <div style={{ borderTop: "1px solid #e5e7eb", display: "grid", gap: "0.5rem", paddingTop: "0.5rem" }}>
        <button formAction={acceptAction} type="submit" disabled={isAcceptPending}>{isAcceptPending ? "Принимаем..." : "Принять candidates >= 90%"}</button>
        {acceptState.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{acceptState.error}</p> : null}
        {acceptState.message ? <p style={{ color: "#047857", margin: 0 }}>{acceptState.message}</p> : null}
      </div>
    </form>
  );
}
