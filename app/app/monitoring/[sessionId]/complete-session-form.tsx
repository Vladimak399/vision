"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { completeMonitoringSession } from "../actions";

export function CompleteSessionForm({ sessionId, status }: { sessionId: string; status: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (formData: FormData) => {
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await completeMonitoringSession({}, formData);

      if (result.error) {
        setError(result.error);
      } else if (result.message) {
        setMessage(result.message);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Произошла ошибка");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canComplete = ["draft", "uploading", "processing", "review"].includes(status);

  if (!canComplete) {
    return null;
  }

  return (
    <form
      action={handleSubmit}
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem",
        background: "#f9fafb",
        marginTop: "1rem",
      }}
    >
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem", fontWeight: "600" }}>
        Завершить сессию
      </h3>

      <input type="hidden" name="session_id" value={sessionId} />

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          type="submit"
          name="status"
          value="completed"
          disabled={isSubmitting}
          style={{
            padding: "0.5rem 1rem",
            border: "1px solid #10b981",
            background: "#10b981",
            color: "white",
            borderRadius: "6px",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            fontSize: "0.875rem",
          }}
        >
          {isSubmitting ? "Завершение..." : "Завершить сессию"}
        </button>

        <button
          type="submit"
          name="status"
          value="cancelled"
          disabled={isSubmitting}
          style={{
            padding: "0.5rem 1rem",
            border: "1px solid #6b7280",
            background: "#6b7280",
            color: "white",
            borderRadius: "6px",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            fontSize: "0.875rem",
          }}
        >
          {isSubmitting ? "Отмена..." : "Отменить сессию"}
        </button>
      </div>

      {error && (
        <div style={{ color: "#dc2626", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
          {error}
        </div>
      )}

      {message && (
        <div style={{ color: "#059669", fontSize: "0.875rem" }}>
          {message}
        </div>
      )}

      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.5rem" }}>
        <p>• Завершённую сессию нельзя изменить</p>
        <p>• Отменённую сессию можно создать заново</p>
      </div>
    </form>
  );
}