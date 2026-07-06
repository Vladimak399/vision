"use client";

import { useActionState } from "react";

import { processQueuedRecognitionJobs, type ProcessQueueState } from "../worker-actions";

const initialState: ProcessQueueState = {};
const batchSizes = [1, 5, 10] as const;

export function ProcessQueueForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(processQueuedRecognitionJobs, initialState);
  const href = `/app/monitoring/${sessionId}` + "/review";

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {batchSizes.map((batchSize) => (
          <form key={batchSize} action={formAction}>
            <input type="hidden" name="session_id" value={sessionId} />
            <input type="hidden" name="batch_size" value={batchSize} />
            <button type="submit" disabled={isPending}>
              {isPending ? "Идет обработка..." : `Обработать ${batchSize} фото`}
            </button>
          </form>
        ))}
      </div>
      <p style={{ color: "#4b5563", margin: 0 }}>Для больших магазинов обрабатывай фото партиями. Максимум за один запуск: 10.</p>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      <a href={href}>Проверить товары</a>
    </div>
  );
}
