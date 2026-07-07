import { createCorrectedCatalogMatch } from "./manual-catalog-match-actions";
import { updateRecognizedItem, updateRecognizedItemStatus } from "./recognized-item-review-actions";

type CatalogSuggestion = {
  product: {
    id: string;
    external_sku: string | null;
    name: string;
    brand: string | null;
    size_text: string | null;
    own_price_minor: number | null;
    currency: string | null;
  };
  score: number;
  reasons: string[];
};

type Props = {
  sessionId: string;
  item: {
    id: string;
    raw_name: string;
    brand: string | null;
    size_text: string | null;
    price_minor: number | null;
    old_price_minor: number | null;
    promo_price_minor: number | null;
    price_tag_text: string | null;
    product_visible_text: string | null;
    review_reason: string | null;
    position_hint: string | null;
  };
  suggestions?: CatalogSuggestion[];
};

type ReviewStatus = "needs_review" | "confirmed" | "rejected" | "unmatched";

const fieldStyle = { width: "100%", minWidth: 180, padding: "0.35rem", border: "1px solid #d1d5db", borderRadius: 6 } as const;
const suggestionStyle = { border: "1px solid #e5e7eb", borderRadius: 8, display: "grid", gap: "0.35rem", padding: "0.5rem" } as const;

export function RecognizedItemReviewControls({ sessionId, item, suggestions = [] }: Props) {
  return (
    <div style={{ display: "grid", gap: "0.5rem", minWidth: 260 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        <StatusForm sessionId={sessionId} itemId={item.id} status="confirmed" label="OCR верно" />
        <StatusForm sessionId={sessionId} itemId={item.id} status="rejected" label="Ошибка OCR" />
        <StatusForm sessionId={sessionId} itemId={item.id} status="needs_review" label="На проверку" />
        <StatusForm sessionId={sessionId} itemId={item.id} status="unmatched" label="Нет в ассортименте" />
      </div>

      <details open={suggestions.length > 0}>
        <summary style={{ cursor: "pointer" }}>Связать с каталогом</summary>
        <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
          {suggestions.length > 0 ? (
            <div style={{ display: "grid", gap: "0.4rem" }}>
              <strong>Подсказки из каталога</strong>
              {suggestions.map((suggestion) => (
                <form key={suggestion.product.id} action={createCorrectedCatalogMatch} style={suggestionStyle}>
                  <input type="hidden" name="session_id" value={sessionId} />
                  <input type="hidden" name="item_id" value={item.id} />
                  <input type="hidden" name="catalog_query" value={suggestion.product.external_sku ?? suggestion.product.name} />
                  <div>
                    <strong>{suggestion.product.name}</strong>
                    <p style={{ color: "#4b5563", margin: "0.2rem 0 0" }}>
                      SKU: {suggestion.product.external_sku ?? "—"} · бренд: {suggestion.product.brand ?? "—"} · размер: {suggestion.product.size_text ?? "—"} · наша цена: {formatPrice(suggestion.product.own_price_minor, suggestion.product.currency)} · score: {formatPercent(suggestion.score)}
                    </p>
                  </div>
                  <button type="submit">Связать этот товар</button>
                </form>
              ))}
            </div>
          ) : (
            <p style={{ color: "#6b7280", margin: 0 }}>Автоподсказок нет. Можно ввести точный SKU или часть названия вручную.</p>
          )}

          <form action={createCorrectedCatalogMatch} style={{ display: "grid", gap: "0.4rem" }}>
            <input type="hidden" name="session_id" value={sessionId} />
            <input type="hidden" name="item_id" value={item.id} />
            <input name="catalog_query" placeholder="SKU или часть названия из каталога" required style={fieldStyle} />
            <button type="submit">Связать вручную</button>
          </form>
        </div>
      </details>

      <details>
        <summary style={{ cursor: "pointer" }}>Правка OCR</summary>
        <form action={updateRecognizedItem} style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}>
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="item_id" value={item.id} />
          <input name="raw_name" defaultValue={item.raw_name} required style={fieldStyle} />
          <input name="brand" defaultValue={item.brand ?? ""} style={fieldStyle} />
          <input name="size_text" defaultValue={item.size_text ?? ""} style={fieldStyle} />
          <input name="price" defaultValue={formatRubInput(item.price_minor)} inputMode="decimal" style={fieldStyle} />
          <input name="old_price" defaultValue={formatRubInput(item.old_price_minor)} inputMode="decimal" style={fieldStyle} />
          <input name="promo_price" defaultValue={formatRubInput(item.promo_price_minor)} inputMode="decimal" style={fieldStyle} />
          <textarea name="price_tag_text" defaultValue={item.price_tag_text ?? ""} rows={2} style={fieldStyle} />
          <textarea name="product_visible_text" defaultValue={item.product_visible_text ?? ""} rows={2} style={fieldStyle} />
          <textarea name="review_reason" defaultValue={item.review_reason ?? ""} rows={2} style={fieldStyle} />
          <input name="position_hint" defaultValue={item.position_hint ?? ""} style={fieldStyle} />
          <button type="submit">Сохранить правки</button>
        </form>
      </details>
    </div>
  );
}

function StatusForm({ sessionId, itemId, status, label }: { sessionId: string; itemId: string; status: ReviewStatus; label: string }) {
  return (
    <form action={updateRecognizedItemStatus}>
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="status" value={status} />
      <button type="submit">{label}</button>
    </form>
  );
}

function formatRubInput(value: number | null) {
  return value === null ? "" : (value / 100).toFixed(2);
}

function formatPrice(value: number | null, currency: string | null) {
  return value === null ? "—" : `${(value / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "RUB"}`;
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${Math.round(value * 100)}%`;
}
