"use client";

import { useActionState } from "react";

import { runRecognitionFlow, type RecognitionFlowState } from "./recognition-flow-actions";

const initialState: RecognitionFlowState = {};

export function QueueRecognitionForm({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const [state, formAction, isPending] = useActionState(runRecognitionFlow, initialState);

  return (
    <form action={formAction} style={{ display: "grid", gap: "0.5rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <button type="submit" disabled={disabled || isPending}>
        {isPending ? "Распознаём фото..." : "Распознать новые фото"}
      </button>
      {disabled ? (
        <p style={{ color: "#4b5563", margin: 0 }}>Новых фото для распознавания нет.</p>
      ) : null}
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
    </form>
  );
}
