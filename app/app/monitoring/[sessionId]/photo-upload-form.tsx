"use client";

import { useActionState, useState, type FormEvent } from "react";

import { uploadMonitoringPhotos, type MonitoringPhotoUploadState } from "../actions";

const initialState: MonitoringPhotoUploadState = {};
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function MonitoringPhotoUploadForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(uploadMonitoringPhotos, initialState);
  const [clientError, setClientError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const files = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);

    if (files.length === 0) {
      event.preventDefault();
      setClientError("Выберите хотя бы одно фото.");
      return;
    }

    for (const file of files) {
      if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
        event.preventDefault();
        setClientError(`Файл ${file.name || "без названия"} имеет неподдерживаемый тип. Разрешены JPEG, PNG и WebP.`);
        return;
      }

      if (file.size > MAX_PHOTO_SIZE_BYTES) {
        event.preventDefault();
        setClientError(`Файл ${file.name || "без названия"} больше 10 МБ.`);
        return;
      }
    }

    setClientError(null);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Загрузить фото</span>
        <input
          type="file"
          name="photos"
          accept="image/jpeg,image/png,image/webp"
          multiple
          required
          disabled={isPending}
        />
      </label>
      <p style={{ color: "#4b5563", margin: 0 }}>JPEG, PNG или WebP, до 10 МБ на файл.</p>
      {clientError ? <p style={{ color: "#b91c1c", margin: 0 }}>{clientError}</p> : null}
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      <button type="submit" disabled={isPending}>{isPending ? "Загрузка..." : "Загрузить фото"}</button>
    </form>
  );
}
