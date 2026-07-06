"use client";

import { useActionState } from "react";

import { createManualRecognizedItem, type ManualRecognizedItemState } from "../actions";

type PhotoOption = {
  id: string;
  label: string;
};

const initialState: ManualRecognizedItemState = {};

export function ManualRecognizedItemForm({ sessionId, photos }: { sessionId: string; photos: PhotoOption[] }) {
  const [state, formAction, isPending] = useActionState(createManualRecognizedItem, initialState);

  if (photos.length === 0) {
    return (
      <p style={{ color: "#4b5563", margin: 0 }}>
        Сначала загрузите фото. Ручное добавление понадобится только как запасной вариант, если AI не распознает товар или потребуется корректировка.
      </p>
    );
  }

  return (
    <form action={formAction} style={{ display: "grid", gap: "0.75rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="currency" value="RUB" />

      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Фото *</span>
        <select name="photo_id" required defaultValue="" disabled={isPending}>
          <option value="" disabled>
            Выберите фото
          </option>
          {photos.map((photo) => (
            <option key={photo.id} value={photo.id}>
              {photo.label}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Название товара *</span>
        <input name="raw_name" required maxLength={300} disabled={isPending} />
      </label>

      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Цена, ₽ *</span>
        <input name="price_rub" required inputMode="decimal" placeholder="99,99" disabled={isPending} />
      </label>

      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Бренд</span>
        <input name="brand" maxLength={160} disabled={isPending} />
      </label>

      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Размер / вес / объём</span>
        <input name="size_text" maxLength={160} placeholder="500 г" disabled={isPending} />
      </label>

      <p style={{ color: "#4b5563", margin: 0 }}>Заполняйте вручную только для fallback-коррекции. Валюта: RUB.</p>
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      <button type="submit" disabled={isPending}>{isPending ? "Сохранение..." : "Добавить вручную"}</button>
    </form>
  );
}
