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
          {isPending ? "Идет обработка..." : "Обработать следующую пачку"}
        </button>
      </form>
      <p style={{ color: "#4b5563", margin: 0 }}>Берёт из очереди до 10 фото. Для большого магазина нажимай повторно, пока queued не станет 0.</p>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      <a href={href}>Проверить товары</a>
    </div>
  );
}
