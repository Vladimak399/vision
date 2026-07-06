"use client";

import { useActionState } from "react";

import { queueRecognitionForSession, type QueueRecognitionState } from "../actions";

const initialState: QueueRecognitionState = {};

export function QueueRecognitionForm({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const [state, formAction, isPending] = useActionState(queueRecognitionForSession, initialState);

  return (
    <form action={formAction} style={{ display: "grid", gap: "0.5rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <button type="submit" disabled={disabled || isPending}>
        {isPending ? "Ставим в очередь..." : "Поставить фото в очередь на распознавание"}
      </button>
      {disabled ? (
        <p style={{ color: "#4b5563", margin: 0 }}>Нет фото со статусом uploaded или failed для постановки в очередь.</p>
      ) : null}
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
    </form>
  );
}
