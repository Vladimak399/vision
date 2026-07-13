export type ShelfRecognitionInput =
  | {
      imageUrl: string;
      imageBase64?: never;
      mimeType?: never;
    }
  | {
      imageUrl?: never;
      imageBase64: string;
      mimeType: string;
    };

export type ShelfRecognitionBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShelfRecognitionItem = {
  raw_name: string | null;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: "RUB";
  price_tag_text: string | null;
  product_visible_text: string | null;
  confidence: number;
  link_confidence: number;
  needs_review: boolean;
  review_reason: string | null;
  position_hint: string | null;
  bbox: ShelfRecognitionBbox | null;
};

export type ShelfRecognitionPayload = {
  items: ShelfRecognitionItem[];
  warnings: string[];
  normalizeError?: string;
  raw?: unknown;
};

export type ShelfRecognitionUsage = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_microusd: number | null;
  duration_ms: number;
};

export type ShelfRecognitionResult = ShelfRecognitionPayload & {
  usage: ShelfRecognitionUsage;
};

// "Свободные" типы для парсинга ответов AI — разные провайдеры возвращают поля
// под разными ключами (name/product_name/title, price/price_text/current_price и т.д.).
export type LooseRecognitionItem = Omit<Partial<ShelfRecognitionItem>, "bbox"> & {
  bbox?: unknown;
  name?: unknown;
  product_name?: unknown;
  product?: unknown;
  title?: unknown;
  price?: unknown;
  price_text?: unknown;
  current_price_minor?: unknown;
  current_price?: unknown;
  old_price?: unknown;
  old_price_text?: unknown;
  promo_price?: unknown;
  promo_price_text?: unknown;
  packaging_text?: unknown;
  visible_text?: unknown;
  location?: unknown;
};

export type LooseRecognitionPayload = Partial<ShelfRecognitionPayload> & {
  products?: LooseRecognitionItem[];
  results?: LooseRecognitionItem[];
  data?: LooseRecognitionItem[] | { items?: LooseRecognitionItem[]; products?: LooseRecognitionItem[]; warnings?: unknown };
  warning?: unknown;
};
