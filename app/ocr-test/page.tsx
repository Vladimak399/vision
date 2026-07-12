"use client";

import Link from "next/link";
import { ChangeEvent, useMemo, useState } from "react";

type OcrResult = {
  provider?: string;
  model?: string;
  fallbackUsed?: boolean;
  raw?: string;
  parsed?: unknown;
  usage?: unknown;
  error?: string;
  details?: string[];
};

const modelOptions = [
  {
    value: "nvidia/nemotron-nano-12b-v2-vl:free",
    label: "NVIDIA Nemotron Nano VL free",
  },
  {
    value: "qwen/qwen2.5-vl-72b-instruct",
    label: "Qwen2.5-VL 72B",
  },
  {
    value: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getItems(parsed: unknown): Record<string, unknown>[] {
  if (!isRecord(parsed)) {
    return [];
  }

  const items = parsed.items;
  if (!Array.isArray(items)) {
    return [];
  }

  return items.filter(isRecord);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Не удалось прочитать фото."));
    };

    reader.onerror = () => reject(new Error("Не удалось прочитать фото."));
    reader.readAsDataURL(file);
  });
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export default function OcrTestPage() {
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const [model, setModel] = useState(modelOptions[0].value);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const items = useMemo(() => getItems(result?.parsed), [result?.parsed]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setError("");
    setResult(null);

    if (!file) {
      setImageDataUrl("");
      setFileName("");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Выбери фото в формате JPG, PNG или WEBP.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("Фото тяжелее 8 МБ. Сожми его или выбери другое.");
      return;
    }

    try {
      setFileName(file.name);
      setImageDataUrl(await readFileAsDataUrl(file));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Не удалось прочитать фото.");
    }
  }

  async function runOcr() {
    if (!imageDataUrl) {
      setError("Сначала выбери фото полки или ценников.");
      return;
    }

    setIsLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/ocr/openrouter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageDataUrl,
          model,
        }),
      });

      const payload = (await response.json()) as OcrResult;

      if (!response.ok) {
        setError(payload.error || "OpenRouter OCR вернул ошибку.");
        setResult(payload);
        return;
      }

      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось отправить фото на OCR.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="hero-panel">
        <div className="hero" style={{ position: "relative", zIndex: 1 }}>
          <div>
            <p className="eyebrow">OpenRouter OCR · full photo</p>
            <h1>Проверка распознавания полной фотографии</h1>
            <p className="lead">
              Загрузи фото полки целиком. Модель попробует вытащить все видимые цены,
              названия, объемы, акции и предупреждения без предварительной нарезки ценников.
            </p>
          </div>
          <div className="actions">
            <Link className="btn btn-secondary" href="/">
              На главную
            </Link>
            <Link className="btn btn-secondary" href="/app">
              Открыть приложение
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="card">
          <p className="eyebrow">Фото</p>
          <h2>Загрузка тестового снимка</h2>
          <p className="muted">
            Ключ OpenRouter не попадает в браузер. Страница отправляет фото на серверный route,
            а уже он обращается к OpenRouter.
          </p>

          <label className="field" style={{ marginTop: "1rem" }}>
            Модель
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field" style={{ marginTop: "1rem" }}>
            Фото полки
            <input accept="image/png,image/jpeg,image/webp" type="file" onChange={handleFileChange} />
          </label>

          {fileName ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              Выбрано: <b>{fileName}</b>
            </p>
          ) : null}

          {imageDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Загруженное фото для OCR"
              src={imageDataUrl}
              style={{
                width: "100%",
                maxHeight: "420px",
                objectFit: "contain",
                borderRadius: "18px",
                border: "1px solid var(--border)",
                marginTop: "1rem",
                background: "#fff",
              }}
            />
          ) : (
            <div className="empty" style={{ marginTop: "1rem" }}>
              <b>Фото пока не выбрано</b>
              <span className="muted">Можно загрузить обычный снимок полки с телефона.</span>
            </div>
          )}

          {error ? (
            <div className="alert alert-bad" style={{ marginTop: "1rem" }}>
              {error}
            </div>
          ) : null}

          <div className="actions" style={{ marginTop: "1rem" }}>
            <button disabled={isLoading || !imageDataUrl} type="button" onClick={runOcr}>
              {isLoading ? "Распознаю..." : "Проверить OCR через OpenRouter"}
            </button>
          </div>
        </div>

        <div className="card soft">
          <p className="eyebrow">Результат</p>
          <h2>Что вернула модель</h2>

          {!result ? (
            <div className="empty" style={{ marginTop: "1rem" }}>
              <b>Результат появится здесь</b>
              <span className="muted">
                Для первого теста лучше взять фото, где на ценниках видны и цена, и название товара.
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
              <div className="pill-row">
                <span className="badge badge-info">{result.provider || "openrouter"}</span>
                <span className="badge badge-neutral">{result.model || model}</span>
                {result.fallbackUsed ? <span className="badge badge-warn">fallback</span> : null}
              </div>

              {items.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Цена</th>
                        <th>Товар / текст</th>
                        <th>Объем</th>
                        <th>Уверенность</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={`${formatValue(item.raw_text)}-${index}`}>
                          <td>
                            <b>{formatValue(item.price)}</b>
                            <br />
                            <span className="muted">{formatValue(item.currency)}</span>
                          </td>
                          <td>
                            <b>{formatValue(item.possible_product_name)}</b>
                            <br />
                            <span className="muted">{formatValue(item.raw_text)}</span>
                          </td>
                          <td>{formatValue(item.weight_or_volume)}</td>
                          <td>{formatValue(item.confidence)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <textarea
                readOnly
                value={JSON.stringify(result.parsed ?? result.raw ?? result, null, 2)}
                style={{
                  width: "100%",
                  minHeight: "360px",
                  border: "1px solid var(--border)",
                  borderRadius: "18px",
                  padding: "1rem",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: ".88rem",
                  lineHeight: 1.55,
                  resize: "vertical",
                  background: "#fff",
                  color: "var(--text)",
                }}
              />
            </div>
          )}
        </div>
      </section>

      <section className="alert alert-warn">
        Это тестовый full-photo OCR. Результат нельзя автоматически считать доказанной связкой
        товар ↔ ценник, пока в пайплайне нет bbox/crop-проверки или ручного review.
      </section>
    </main>
  );
}
