"use client";

import { useActionState } from "react";

import { processQueuedRecognitionJobs, type ProcessQueueState } from "../worker-actions";

const initialState: ProcessQueueState = {};

export function ProcessQueueForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(processQueuedRecognitionJobs, initialState);
  const href = `/app/monitoring/${sessionId}` + "/review";

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <form action={formAction} style={{ display: "grid", gap: "0.5rem" }}>
        <input type="hidden" name="session_id" value={sessionId} />
        <button type="submit" disabled={isPending}>
          {isPending ? "Идет обработка..." : "Обработать 1 фото"}
        </button>
        {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
        {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      </form>
      <a href={href}>Проверить товары</a>
    </div>
  );
}
