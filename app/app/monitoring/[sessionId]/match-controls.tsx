"use client";

import Link from "next/link";
import { useActionState } from "react";

import { acceptHighConfidenceMatchesForSession, aiReviewMatchesForSession, suggestCatalogMatchesForSession, type MatchActionState } from "./match-actions";

const initialState: MatchActionState = {};

export function MatchControls({ sessionId, department }: { sessionId: string; department: string }) {
  const [state, formAction, isPending] = useActionState(suggestCatalogMatchesForSession, initialState);
  const [aiState, aiAction, isAiPending] = useActionState(aiReviewMatchesForSession, initialState);
  const [acceptState, acceptAction, isAcceptPending] = useActionState(acceptHighConfidenceMatchesForSession, initialState);
  const reviewHref = `/app/monitoring/${sessionId}/review${department !== "all" ? `?department=${department}` : ""}`;
  const withCandidateHref = buildReviewHref(sessionId, department, { candidates: "with_candidate" });
  const withoutCandidateHref = buildReviewHref(sessionId, department, { candidates: "without_candidate" });
  const aiCandidateHref = buildReviewHref(sessionId, department, { queue: "ai_candidate" });
  const sizeRiskHref = buildReviewHref(sessionId, department, { queue: "size_risk" });
  const missingOwnPriceHref = buildReviewHref(sessionId, department, { queue: "missing_own_price" });
  const missingCompetitorPriceHref = buildReviewHref(sessionId, department, { queue: "missing_competitor_price" });

  return (
    <form action={formAction} style={{ border: "1px solid #d1d5db", borderRadius: 12, display: "grid", gap: "0.75rem", padding: "1rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      {department !== "all" ? <input type="hidden" name="department" value={department} /> : null}

      <div style={{ display: "grid", gap: "0.35rem" }}>
        <strong>Автоподбор и проверка</strong>
        <p style={{ color: "#4b5563", margin: 0 }}>
          Порядок работы: 1) подобрать кандидатов, 2) проверить строки без кандидата, 3) отдельно проверить риск размера и AI-candidates, 4) принять только безопасные совпадения, 5) выгрузить Excel.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <Link href={`/app/monitoring/${sessionId}`} style={pillStyle}>Сессия</Link>
        <Link href={reviewHref} style={pillStyle}>Все строки</Link>
        <Link href={withoutCandidateHref} style={pillStyle}>Без кандидата</Link>
        <Link href={withCandidateHref} style={pillStyle}>С кандидатом</Link>
        <Link href={aiCandidateHref} style={pillStyle}>AI candidates</Link>
        <Link href={sizeRiskHref} style={pillStyle}>Риск размера</Link>
        <Link href={missingOwnPriceHref} style={pillStyle}>Нет нашей цены</Link>
        <Link href={missingCompetitorPriceHref} style={pillStyle}>Нет цены конкурента</Link>
        <a href={`/app/monitoring/${sessionId}/export.xlsx`} style={pillStyle}>Короткий Excel</a>
        <a href={`/app/monitoring/${sessionId}/export-detailed.xlsx`} style={pillStyle}>Detailed Excel</a>
      </div>

      <button type="submit" disabled={isPending}>{isPending ? "Подбираем..." : "1. Подобрать кандидатов"}</button>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}

      <button formAction={aiAction} type="submit" disabled={isAiPending}>{isAiPending ? "AI-review..." : "2. AI-review спорных"}</button>
      <p style={{ color: "#6b7280", margin: 0 }}>AI-review не ставит “Нет в ассортименте” и не принимает товар автоматически. Он только предлагает кандидата, который надо подтвердить вручную.</p>
      {aiState.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{aiState.error}</p> : null}
      {aiState.message ? <p style={{ color: "#047857", margin: 0 }}>{aiState.message}</p> : null}

      <button formAction={acceptAction} type="submit" disabled={isAcceptPending}>{isAcceptPending ? "Принимаем..." : "3. Принять безопасные candidates >= 90%"}</button>
      <p style={{ color: "#6b7280", margin: 0 }}>Массовое принятие игнорирует AI-review candidates и пропускает риск размера: если OCR не видит граммовку, а кандидат размерный, строка остаётся на ручной проверке.</p>
      {acceptState.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{acceptState.error}</p> : null}
      {acceptState.message ? <p style={{ color: "#047857", margin: 0 }}>{acceptState.message}</p> : null}
    </form>
  );
}

const pillStyle = {
  border: "1px solid #d1d5db",
  borderRadius: 999,
  color: "inherit",
  padding: "0.25rem 0.6rem",
  textDecoration: "none",
} as const;

function buildReviewHref(sessionId: string, department: string, filters: { candidates?: "with_candidate" | "without_candidate"; queue?: string }) {
  const params = new URLSearchParams();
  if (department !== "all") params.set("department", department);
  if (filters.candidates) params.set("candidates", filters.candidates);
  if (filters.queue) params.set("queue", filters.queue);
  return `/app/monitoring/${sessionId}/review?${params.toString()}`;
}
