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
  const withCandidateHref = buildReviewHref(sessionId, department, "with_candidate");
  const withoutCandidateHref = buildReviewHref(sessionId, department, "without_candidate");

  return (
    <form action={formAction} style={{ border: "1px solid #d1d5db", borderRadius: 12, display: "grid", gap: "0.75rem", padding: "1rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      {department !== "all" ? <input type="hidden" name="department" value={department} /> : null}

      <div style={{ display: "grid", gap: "0.35rem" }}>
        <strong>Автоподбор и проверка</strong>
        <p style={{ color: "#4b5563", margin: 0 }}>
          Порядок работы: 1) подобрать кандидатов, 2) проверить строки без кандидата, 3) запустить AI-review только для спорных, 4) вручную принять безопасные совпадения, 5) выгрузить Excel.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <Link href={`/app/monitoring/${sessionId}`} style={pillStyle}>Сессия</Link>
        <Link href={reviewHref} style={pillStyle}>Все строки</Link>
        <Link href={withoutCandidateHref} style={pillStyle}>Без кандидата</Link>
        <Link href={withCandidateHref} style={pillStyle}>С кандидатом</Link>
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

      <button formAction={acceptAction} type="submit" disabled={isAcceptPending}>{isAcceptPending ? "Принимаем..." : "3. Принять candidates >= 90%"}</button>
      <p style={{ color: "#6b7280", margin: 0 }}>Массовое принятие игнорирует AI-review candidates. Их нужно принять руками.</p>
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

function buildReviewHref(sessionId: string, department: string, candidates: "with_candidate" | "without_candidate") {
  const params = new URLSearchParams();
  if (department !== "all") params.set("department", department);
  params.set("candidates", candidates);
  return `/app/monitoring/${sessionId}/review?${params.toString()}`;
}
