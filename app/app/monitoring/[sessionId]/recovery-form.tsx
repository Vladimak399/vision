"use client";

import { useActionState } from "react";

import { recoverStaleOcrWork, type RecoveryState } from "./recovery-actions";

const initialState: RecoveryState = {};

export function RecoveryForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(recoverStaleOcrWork, initialState);

  return (
    <form action={formAction} style={{ display: "grid", gap: "0.5rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <button type="submit" disabled={isPending}>{isPending ? "Проверяем..." : "Восстановить зависшие OCR-задачи"}</button>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
    </form>
  );
}
