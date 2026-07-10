/**
 * AI Telemetry — логирование AI запросов (OCR, matching)
 * TASK-37
 */

export type AiTelemetryEntry = {
  provider: string;
  model: string;
  operation: "vision" | "text";
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  fallback_used: boolean;
  error: string | null;
  estimated_cost_usd: number | null;
  timestamp: string;
};

const telemetry: AiTelemetryEntry[] = [];
const MAX_LOG = 100;

export function recordAiTelemetry(entry: AiTelemetryEntry): void {
  telemetry.unshift(entry);
  if (telemetry.length > MAX_LOG) telemetry.pop();

  // В production можно писать в БД или лог-файл
  if (process.env.NODE_ENV === "development") {
    console.log(
      `[AI] ${entry.operation} | ${entry.provider}/${entry.model} | ${entry.duration_ms}ms | tokens: ${entry.input_tokens}+${entry.output_tokens}${entry.fallback_used ? " ⚠️ fallback" : ""}${entry.error ? ` ❌ ${entry.error}` : ""}`,
    );
  }
}

export function getAiTelemetry(count = 50): AiTelemetryEntry[] {
  return telemetry.slice(0, count);
}

export function getAiTelemetryStats() {
  const total = telemetry.length;
  const vision = telemetry.filter((e) => e.operation === "vision");
  const text = telemetry.filter((e) => e.operation === "text");
  const errors = telemetry.filter((e) => e.error);
  const fallbacks = telemetry.filter((e) => e.fallback_used);

  return {
    total,
    vision: vision.length,
    text: text.length,
    errors: errors.length,
    fallbacks: fallbacks.length,
    avgDurationMs: total
      ? Math.round(telemetry.reduce((s, e) => s + e.duration_ms, 0) / total)
      : 0,
    totalCostUsd: telemetry.reduce((s, e) => s + (e.estimated_cost_usd ?? 0), 0),
  };
}