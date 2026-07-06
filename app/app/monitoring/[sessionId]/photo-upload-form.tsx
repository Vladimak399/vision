"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";

import { uploadMonitoringPhotos, type MonitoringPhotoUploadState } from "../actions";

const initialState: MonitoringPhotoUploadState = {};
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BATCH_BYTES = 9 * 1024 * 1024;
const COMPRESSION_TARGET_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_LONG_SIDE = 2400;
const JPEG_QUALITY_STEPS = [0.9, 0.86, 0.82] as const;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UNSUPPORTED_IPHONE_TYPES = new Set(["image/heic", "image/heif"]);

type PreparedPhoto = {
  file: File;
  originalSize: number;
  compressed: boolean;
};

function formatFileSize(size: number) {
  const megabytes = size / (1024 * 1024);
  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} МБ`;
}

function getPreparedFileName(file: File) {
  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  return `${baseName}.jpg`;
}

function getPreparedPhotosBatches(photos: PreparedPhoto[]) {
  const batches: PreparedPhoto[][] = [];
  let currentBatch: PreparedPhoto[] = [];
  let currentBatchSize = 0;

  for (const photo of photos) {
    const photoSize = photo.file.size;

    if (currentBatch.length > 0 && currentBatchSize + photoSize > MAX_UPLOAD_BATCH_BYTES) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchSize = 0;
    }

    currentBatch.push(photo);
    currentBatchSize += photoSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas did not return a blob."));
          return;
        }

        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

async function decodeImage(file: File) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }

  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image could not be decoded."));
      element.src = url;
    });

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressImage(file: File) {
  const image = await decodeImage(file);
  const longSide = Math.max(image.width, image.height);
  const scale = longSide > MAX_IMAGE_LONG_SIDE ? MAX_IMAGE_LONG_SIDE / longSide : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  if ("close" in image && typeof image.close === "function") {
    image.close();
  }

  let bestBlob: Blob | null = null;

  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await canvasToJpegBlob(canvas, quality);
    bestBlob = blob;

    if (blob.size <= COMPRESSION_TARGET_BYTES) {
      break;
    }
  }

  if (!bestBlob) {
    throw new Error("Image compression did not produce a file.");
  }

  return new File([bestBlob], getPreparedFileName(file), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.size <= COMPRESSION_TARGET_BYTES) {
    return { file, originalSize: file.size, compressed: false };
  }

  const compressedFile = await compressImage(file);

  if (file.size <= MAX_PHOTO_SIZE_BYTES && compressedFile.size >= file.size) {
    return { file, originalSize: file.size, compressed: false };
  }

  return { file: compressedFile, originalSize: file.size, compressed: true };
}

function createBatchFormData(form: HTMLFormElement, batch: PreparedPhoto[]) {
  const batchFormData = new FormData(form);
  batchFormData.delete("photos");

  for (const photo of batch) {
    batchFormData.append("photos", photo.file, photo.file.name);
  }

  return batchFormData;
}

export function MonitoringPhotoUploadForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(uploadMonitoringPhotos, initialState);
  const [clientError, setClientError] = useState<string | null>(null);
  const [compressionMessage, setCompressionMessage] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const isBusy = isPending || isPreparing;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isBusy) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const files = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);

    setClientError(null);
    setCompressionMessage(null);

    if (files.length === 0) {
      setClientError("Выберите хотя бы одно фото.");
      return;
    }

    for (const file of files) {
      if (UNSUPPORTED_IPHONE_TYPES.has(file.type)) {
        setClientError(`Файл ${file.name || "без названия"} имеет неподдерживаемый формат HEIC/HEIF.`);
        return;
      }

      if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
        setClientError(`Файл ${file.name || "без названия"} имеет неподдерживаемый тип.`);
        return;
      }
    }

    setIsPreparing(true);
    setCompressionMessage("Сжимаем фото перед загрузкой…");

    try {
      const preparedPhotos = await Promise.all(files.map(preparePhoto));
      const oversizedPhoto = preparedPhotos.find((photo) => photo.file.size > MAX_PHOTO_SIZE_BYTES);

      if (oversizedPhoto) {
        setClientError(`Файл ${oversizedPhoto.file.name || "без названия"} после подготовки больше 10 МБ.`);
        setCompressionMessage(null);
        return;
      }

      const compressedPhotos = preparedPhotos.filter((photo) => photo.compressed);
      const batches = getPreparedPhotosBatches(preparedPhotos);
      const batchText = batches.length > 1 ? ` Отправляем ${batches.length} пачками.` : "";

      if (compressedPhotos.length > 0) {
        setCompressionMessage(
          `${compressedPhotos
            .map((photo) => `${photo.file.name}: ${formatFileSize(photo.originalSize)} → ${formatFileSize(photo.file.size)}`)
            .join("; ")}.${batchText}`,
        );
      } else {
        setCompressionMessage(`Фото уже подходят по размеру.${batchText}`);
      }

      startTransition(() => {
        for (const batch of batches) {
          formAction(createBatchFormData(form, batch));
        }
      });
    } catch {
      setClientError("Не удалось подготовить фото.");
      setCompressionMessage(null);
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Отдел</span>
        <select name="department" required disabled={isBusy} defaultValue="products">
          <option value="products">Продукты</option>
          <option value="chemistry">Химия</option>
        </select>
      </label>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Загрузить фото</span>
        <input
          type="file"
          name="photos"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple
          required
          disabled={isBusy}
        />
      </label>
      <p style={{ color: "#4b5563", margin: 0 }}>Выбери отдел и загрузи пачку фото. Для другого отдела загрузи отдельную пачку.</p>
      {isPreparing ? <p style={{ color: "#4b5563", margin: 0 }}>Подготавливаем фото…</p> : null}
      {compressionMessage ? <p style={{ color: "#4b5563", margin: 0 }}>{compressionMessage}</p> : null}
      {clientError ? <p style={{ color: "#b91c1c", margin: 0 }}>{clientError}</p> : null}
      {state.error ? <p style={{ color: "#b91c1c", margin: 0 }}>{state.error}</p> : null}
      {state.message ? <p style={{ color: "#047857", margin: 0 }}>{state.message}</p> : null}
      <button type="submit" disabled={isBusy}>{isPreparing ? "Подготовка..." : isPending ? "Загрузка..." : "Загрузить фото"}</button>
    </form>
  );
}
