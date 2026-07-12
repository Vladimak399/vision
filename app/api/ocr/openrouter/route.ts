import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type OpenRouterMessageContent = Array<
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    }
>;

type OpenRouterChoice = {
  message?: {
    content?: string;
  };
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
  usage?: unknown;
  error?: {
    message?: string;
  };
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_OCR_MODEL || "nvidia/nemotron-nano-12b-v2-vl:free";
const FALLBACK_MODEL = process.env.OPENROUTER_OCR_FALLBACK_MODEL || "qwen/qwen2.5-vl-72b-instruct";
const MAX_IMAGE_DATA_URL_LENGTH = 12_000_000;

function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IMAGE_DATA_URL_LENGTH &&
    /^data:image\/(png|jpe?g|webp);base64,/i.test(value)
  );
}

function parseModel(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_MODEL;
  }

  return value.trim();
}

function buildPrompt() {
  return `Ты OCR-модуль PriceVision для мониторинга цен у конкурента по фото полки магазина.

Главная цель:
Получить список ценников конкурента, чтобы потом сравнить цену с нашим каталогом.

Правила:
1. Извлекай только то, что видно на ценнике или рядом с ценником: название, цену, объем/вес, акцию, сырой текст.
2. Не определяй товар по упаковке, если название не читается на ценнике.
3. Не выдумывай бренд, вкус, вес, цену или копейки.
4. Если цена есть, но название товара плохо видно, оставь competitor_product_name пустым и добавь warning.
5. Если видны старая и новая цена, competitor_price должна быть текущей ценой для покупателя, а promo=true.
6. Верни только валидный JSON без Markdown.

Формат:
{
  "items": [
    {
      "competitor_product_name": "",
      "competitor_price": 0,
      "currency": "RUB",
      "raw_price_text": "",
      "raw_text": "",
      "weight_or_volume": "",
      "promo": false,
      "ocr_confidence": 0,
      "warnings": []
    }
  ],
  "photo_warnings": []
}`;
}

function stripMarkdownFences(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function tryParseJson(value: string) {
  const cleaned = stripMarkdownFences(value);

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

function uniqueModels(primaryModel: string) {
  return [primaryModel, FALLBACK_MODEL].filter(
    (model, index, models) => model && models.indexOf(model) === index,
  );
}

async function callOpenRouter(model: string, imageDataUrl: string, apiKey: string) {
  const content: OpenRouterMessageContent = [
    {
      type: "text",
      text: buildPrompt(),
    },
    {
      type: "image_url",
      image_url: {
        url: imageDataUrl,
      },
    },
  ];

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
      "X-Title": "PriceVision Competitor Price Test",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content,
        },
      ],
      temperature: 0,
      max_tokens: 4000,
    }),
  });

  const payload = (await response.json()) as OpenRouterResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter вернул HTTP ${response.status}`);
  }

  const raw = payload.choices?.[0]?.message?.content;

  if (!raw) {
    throw new Error("OpenRouter не вернул текст OCR.");
  }

  return {
    raw,
    parsed: tryParseJson(raw),
    usage: payload.usage,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Не задан OPENROUTER_API_KEY. Добавь ключ в .env.local или в переменные Vercel.",
      },
      { status: 500 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON-запрос." }, { status: 400 });
  }

  const bodyRecord = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const imageDataUrl = bodyRecord.imageDataUrl;

  if (!isImageDataUrl(imageDataUrl)) {
    return NextResponse.json(
      {
        error: "Нужно передать imageDataUrl в формате data:image/jpeg;base64,..., data:image/png;base64,... или data:image/webp;base64,...",
      },
      { status: 400 },
    );
  }

  const primaryModel = parseModel(bodyRecord.model);
  const errors: string[] = [];

  for (const model of uniqueModels(primaryModel)) {
    try {
      const result = await callOpenRouter(model, imageDataUrl, apiKey);

      return NextResponse.json({
        provider: "openrouter",
        mode: "competitor_price_monitoring",
        model,
        fallbackUsed: model !== primaryModel,
        ...result,
      });
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
    }
  }

  return NextResponse.json(
    {
      error: "Не удалось распознать цены конкурента через OpenRouter.",
      details: errors,
    },
    { status: 502 },
  );
}
