"use client";

import { useActionState } from "react";

import { uploadMonitoringPhotos, type MonitoringPhotoUploadState } from "../actions";

const initialState: MonitoringPhotoUploadState = {};

export function MonitoringPhotoUploadForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(uploadMonitoringPhotos, initialState);

  return (
    <form action={formAction} style={{ display: "grid", gap: "0.75rem" }}>
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
      <p style={{ color: "#4b5563", margin: 0 }}>JPEG, PNG или WebP. До 10 МБ на файл.</p>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      <button type="submit" disabled={isPending}>{isPending ? "Загрузка..." : "Загрузить фото"}</button>
    </form>
  );
}
