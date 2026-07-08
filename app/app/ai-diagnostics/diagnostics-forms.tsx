"use client";

import { useActionState } from "react";

import { runTextAiSmokeTest, runVisionAiSmokeTest, type TextSmokeResult, type VisionSmokeResult } from "./actions";

const initialTextState: TextSmokeResult | null = null;
const initialVisionState: VisionSmokeResult | null = null;

export function TextSmokeForm() {
  const [state, formAction, isPending] = useActionState(async () => runTextAiSmokeTest(), initialTextState);

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <form action={formAction}>
        <button disabled={isPending} type="submit">{isPending ? "Проверяем…" : "Проверить text AI"}</button>
      </form>
      {state ? state.ok ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <dl style={{ display: "grid", gap: "0.35rem", margin: 0 }}>
            <ResultRow label="Provider/model" value={`${state.data.usage.provider} / ${state.data.usage.model}`} />
            <ResultRow label="Input tokens" value={state.data.usage.input_tokens || "—"} />
            <ResultRow label="Output tokens" value={state.data.usage.output_tokens || "—"} />
          </dl>
          <pre style={preStyle}>{JSON.stringify(state.data.response, null, 2)}</pre>
        </div>
      ) : (
        <p style={{ color: "#b91c1c" }}>{state.error}</p>
      ) : null}
    </div>
  );
}

export function VisionSmokeForm() {
  const [state, formAction, isPending] = useActionState(async (_state: VisionSmokeResult | null, formData: FormData) => runVisionAiSmokeTest(formData), initialVisionState);

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <form action={formAction} style={{ display: "grid", gap: "0.75rem" }}>
        <input accept="image/jpeg,image/png,image/webp" name="image" required type="file" />
        <button disabled={isPending} type="submit">{isPending ? "Проверяем…" : "Проверить vision AI"}</button>
      </form>
      {state ? state.ok ? <VisionResult result={state.data} /> : <p style={{ color: "#b91c1c" }}>{state.error}</p> : null}
    </div>
  );
}

type VisionOk = Extract<VisionSmokeResult, { ok: true }>["data"];

function VisionResult({ result }: { result: VisionOk }) {
  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <dl style={{ display: "grid", gap: "0.35rem", margin: 0 }}>
        <ResultRow label="Provider/model" value={`${result.provider} / ${result.model}`} />
        <ResultRow label="Duration" value={`${result.duration_ms} ms`} />
        <ResultRow label="Input tokens" value={result.input_tokens || "—"} />
        <ResultRow label="Output tokens" value={result.output_tokens || "—"} />
      </dl>
      <div>
        <strong>Warnings</strong>
        {result.warnings.length > 0 ? <ul>{result.warnings.map((warning) => <li key={warning}>{localizeWarning(warning)}</li>)}</ul> : <p>—</p>}
      </div>
      {result.items.length === 0 ? <EmptyVisionHint /> : null}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Название</th>
              <th style={cellStyle}>Бренд</th>
              <th style={cellStyle}>Размер</th>
              <th style={cellStyle}>Цена</th>
              <th style={cellStyle}>Confidence</th>
              <th style={cellStyle}>Review</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr><td colSpan={6} style={cellStyle}>Распознанные позиции не найдены.{result.warnings.length > 0 ? " Модель не смогла прочитать товары/ценники. Для теста загрузите оригинальное фото, не скриншот, ближе к полке, чтобы ценники читались глазами." : ""}</td></tr>
            ) : result.items.map((item, index) => (
              <tr key={`${item.raw_name ?? "item"}-${index}`}>
                <td style={cellStyle}>{item.raw_name ?? "—"}</td>
                <td style={cellStyle}>{item.brand ?? "—"}</td>
                <td style={cellStyle}>{item.size_text ?? "—"}</td>
                <td style={cellStyle}>{formatPrice(item.price_minor)}</td>
                <td style={cellStyle}>{item.confidence.toFixed(2)}</td>
                <td style={cellStyle}>{item.needs_review ? "Да" : "Нет"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyVisionHint() {
  return (
    <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "0.75rem" }}>
      <strong>Модель не смогла прочитать товары или ценники.</strong>
      <p style={{ marginBottom: 0 }}>Для теста загрузите оригинальное фото, не скриншот, ближе к полке, чтобы ценники читались глазами.</p>
      <ul>
        <li>оригинальное фото, не скриншот;</li>
        <li>ценники читаются глазами;</li>
        <li>товар и ценник в одном кадре;</li>
        <li>без сильных бликов;</li>
        <li>лучше 1–2 полки, не весь стеллаж издалека.</li>
      </ul>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string | number }) {
  return <div><dt style={{ color: "#6b7280" }}>{label}</dt><dd style={{ margin: 0 }}>{value}</dd></div>;
}

function formatPrice(priceMinor: number | null) {
  return typeof priceMinor === "number" ? `${(priceMinor / 100).toFixed(2)} ₽` : "—";
}

function localizeWarning(warning: string) {
  const lower = warning.toLowerCase();

  if (lower.includes("low") && lower.includes("resolution") || lower.includes("blurry") || lower.includes("illegible")) {
    return "Фото слишком размытое или низкого разрешения: модель не может надёжно прочитать ценники.";
  }

  return warning;
}

const cellStyle = { borderBottom: "1px solid #e5e7eb", padding: "0.5rem", textAlign: "left" as const };
const preStyle = { background: "#f3f4f6", borderRadius: 8, overflowX: "auto" as const, padding: "0.75rem" };
