import { updateRecognizedItem, updateRecognizedItemStatus } from "./recognized-item-review-actions";

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
};

type ReviewStatus = "needs_review" | "confirmed" | "rejected" | "unmatched";

const fieldStyle = { width: "100%", minWidth: 180, padding: "0.35rem", border: "1px solid #d1d5db", borderRadius: 6 } as const;

export function RecognizedItemReviewControls({ sessionId, item }: Props) {
  return (
    <div style={{ display: "grid", gap: "0.5rem", minWidth: 260 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        <StatusForm sessionId={sessionId} itemId={item.id} status="confirmed" label="OK" />
        <StatusForm sessionId={sessionId} itemId={item.id} status="rejected" label="Нет" />
        <StatusForm sessionId={sessionId} itemId={item.id} status="needs_review" label="Проверить" />
        <StatusForm sessionId={sessionId} itemId={item.id} status="unmatched" label="Нет в ассортименте" />
      </div>

      <details>
        <summary style={{ cursor: "pointer" }}>Правка</summary>
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
          <button type="submit">Сохранить</button>
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
