"use client";

import { useActionState } from "react";

import { processQueuedRecognitionJobs, type ProcessQueueState } from "../worker-actions";

const initialState: ProcessQueueState = {};

export function ProcessQueueForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(processQueuedRecognitionJobs, initialState);
  const reviewHref = `/app/monitoring/${sessionId}/review`;
  const progressHref = `/app/monitoring/${sessionId}/departments`;
  const exportHref = `/app/monitoring/${sessionId}/export.xlsx`;
  const detailedExportHref = `/app/monitoring/${sessionId}/export-detailed.xlsx`;

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <form action={formAction} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="hidden" name="session_id" value={sessionId} />
        <button type="submit" name="ocr_limit" value="1" disabled={isPending}>
          {isPending ? "Идет обработка..." : "Тест: 1 фото"}
        </button>
        <button type="submit" name="ocr_limit" value="10" disabled={isPending}>
          {isPending ? "Идет обработка..." : "Обработать пачку"}
        </button>
      </form>
      <p style={{ color: "#4b5563", margin: 0 }}>
        Сначала запускай тест на 1 фото. Если распознавание нормальное, запускай пачку до 10 фото и повторяй, пока queued не станет 0.
      </p>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <a href={reviewHref}>Проверить товары</a>
        <a href={progressHref}>Прогресс по отделам</a>
        <a href={exportHref}>Экспорт XLSX</a>
        <a href={detailedExportHref}>Экспорт по листам</a>
      </div>
    </div>
  );
}
