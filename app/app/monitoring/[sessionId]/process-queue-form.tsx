"use client";

import { useActionState } from "react";

import { processQueuedRecognitionJobs, type ProcessQueueState } from "../worker-actions";

const initialState: ProcessQueueState = {};

export function ProcessQueueForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(processQueuedRecognitionJobs, initialState);

  return (
    <form action={formAction} style={{ display: "grid", gap: "0.5rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <button type="submit" disabled={isPending}>
        {isPending ? "Обрабатываем очередь..." : "Dry-run: обработать до 5 queued jobs"}
      </button>
      <p style={{ color: "#4b5563", margin: 0 }}>
        Временная проверка pipeline без AI: queued → processing → processed, session → review.
      </p>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
    </form>
  );
}
