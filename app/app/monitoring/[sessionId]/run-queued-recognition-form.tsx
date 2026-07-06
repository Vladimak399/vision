"use client";

import { useActionState } from "react";

import { runQueuedRecognitionForSession } from "./worker-actions";

const initialState: { error?: string; message?: string } = {};

export function RunQueuedRecognitionForm({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const [state, formAction, isPending] = useActionState(runQueuedRecognitionForSession, initialState);

  return (
    <form action={formAction} style={{ display: "grid", gap: "0.5rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <button type="submit" disabled={disabled || isPending}>
        {isPending ? "Обрабатываем очередь..." : "MVP: обработать очередь без AI"}
      </button>
      {disabled ? <p style={{ color: "#4b5563", margin: 0 }}>Нет фото со статусом queued.</p> : null}
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
    </form>
  );
}
