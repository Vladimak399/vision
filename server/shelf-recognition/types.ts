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
};

export type ShelfRecognitionPayload = {
  items: ShelfRecognitionItem[];
  warnings: string[];
};

export type ShelfRecognitionUsage = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_microusd: number;
  duration_ms: number;
};

export type ShelfRecognitionResult = ShelfRecognitionPayload & {
  usage: ShelfRecognitionUsage;
};
