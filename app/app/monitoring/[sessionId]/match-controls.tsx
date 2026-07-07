"use client";

import { useActionState } from "react";

import { acceptHighConfidenceCandidatesForSession, suggestCatalogMatchesForSession, type MatchActionState } from "./match-actions";

const initialState: MatchActionState = {};

export function MatchControls({ sessionId, department }: { sessionId: string; department: string }) {
  const [state, formAction, isPending] = useActionState(suggestCatalogMatchesForSession, initialState);
  const [acceptState, acceptAction, isAcceptPending] = useActionState(acceptHighConfidenceCandidatesForSession, initialState);

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <form action={formAction} style={{ border: "1px solid #d1d5db", borderRadius: 12, display: "grid", gap: "0.5rem", padding: "1rem" }}>
        <input type="hidden" name="session_id" value={sessionId} />
        {department !== "all" ? <input type="hidden" name="department" value={department} /> : null}
        <strong>Автоподбор из каталога</strong>
        <p style={{ color: "#4b5563", margin: 0 }}>Подбирает candidates из catalog_products по текущему фильтру. Низкая уверенность останется на ручную проверку.</p>
        <button type="submit" disabled={isPending}>{isPending ? "Подбираем…" : "Подобрать candidates"}</button>
        {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
        {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      </form>

      <form action={acceptAction} style={{ border: "1px solid #d1d5db", borderRadius: 12, display: "grid", gap: "0.5rem", padding: "1rem" }}>
        <input type="hidden" name="session_id" value={sessionId} />
        {department !== "all" ? <input type="hidden" name="department" value={department} /> : null}
        <strong>Групповое принятие</strong>
        <p style={{ color: "#4b5563", margin: 0 }}>Принимает только active candidates со score ≥ 90%. Не ставит “Нет в ассортименте” и не трогает спорные строки.</p>
        <button type="submit" disabled={isAcceptPending}>{isAcceptPending ? "Принимаем…" : "Принять уверенные candidates ≥ 90%"}</button>
        {acceptState.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{acceptState.error}</p> : null}
        {acceptState.message ? <p style={{ color: "#047857", margin: 0 }}>{acceptState.message}</p> : null}
      </form>
    </div>
  );
}
