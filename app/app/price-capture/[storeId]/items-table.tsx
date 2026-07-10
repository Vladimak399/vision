"use client";

import { useState } from "react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function getPhotoUrl(photoStoragePath: string | null): string | null {
  if (!photoStoragePath || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/monitoring-photos/${photoStoragePath}`;
}

type ShelfItem = {
  id: string;
  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: string | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
  confidence: number;
  catalog_product_id: string | null;
  match_confidence: number | null;
  match_reason: string | null;
  matched_at: string | null;
  photo_storage_path: string | null;
  photo_filename: string | null;
  captured_date: string;
};

type CatalogProduct = {
  id: string;
  name: string;
  brand: string | null;
  size_text: string | null;
};

type ItemsTableProps = {
  items: ShelfItem[];
  week: 1 | 2;
  storeId: string;
};

function formatPrice(priceMinor: number | null): string {
  if (priceMinor === null) {
    return "—";
  }
  return `${(priceMinor / 100).toFixed(2)} ₽`;
}

function formatConfidence(confidence: number): string {
  return (confidence * 100).toFixed(1) + "%";
}

export function ItemsTable({ items }: ItemsTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [errorIds, setErrorIds] = useState<Set<string>>(new Set());

  const handlePriceClick = (item: ShelfItem) => {
    setEditingId(item.id);
    setEditValue(item.price_minor !== null ? String(item.price_minor / 100) : "");
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
  };

  const handlePriceBlur = async () => {
    if (!editingId) return;

    const newValue = parseFloat(editValue);
    const numValue = isNaN(newValue) || newValue < 0 ? null : newValue;

    setSavingIds((prev) => new Set(prev).add(editingId));
    try {
      const response = await fetch(`/app/price-capture/api/update-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: editingId, price: numValue }),
      });

      if (!response.ok) {
        const error = await response.json();
        setErrorIds((prev) => new Set(prev).add(editingId));
      } else {
        setErrorIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(editingId);
          return newSet;
        });
      }
    } catch {
      setErrorIds((prev) => new Set(prev).add(editingId));
    } finally {
      setSavingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(editingId);
        return newSet;
      });
      setEditingId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handlePriceBlur();
    }
    if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  if (items.length === 0) {
    return (
      <section className="card soft">
        <h3>Товары</h3>
        <p className="muted">Нет распознанных товаров для этого магазина и недели.</p>
      </section>
    );
  }

  return (
    <section className="card soft">
      <h3>Товары</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ backgroundColor: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
              <th style={cellStyle}>Товар</th>
              <th style={cellStyle}>Бренд</th>
              <th style={cellStyle}>Цена</th>
              <th style={cellStyle}>Старая цена</th>
              <th style={cellStyle}>Сопоставлено</th>
              <th style={cellStyle}>Уверенность</th>
              <th style={cellStyle}>Фото</th>
              <th style={cellStyle}>Файл</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isMatched = item.catalog_product_id !== null;
              const isEditing = editingId === item.id;
              const isSaving = savingIds.has(item.id);
              const hasError = errorIds.has(item.id);
              const rowStyle = isMatched
                ? { backgroundColor: "#dcfce7", ...cellStyle }
                : { backgroundColor: "#fef3c7", ...cellStyle };

              return (
                <tr key={item.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <td style={rowStyle}>{item.raw_name}</td>
                  <td style={rowStyle}>{item.brand ?? "—"}</td>
                  <td style={rowStyle}>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editValue}
                        onChange={handlePriceChange}
                        onBlur={handlePriceBlur}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        disabled={isSaving}
                        style={{
                          width: "80px",
                          padding: "0.25rem",
                          border: hasError ? "1px solid #ef4444" : "1px solid #d1d5db",
                          borderRadius: "4px",
                          textAlign: "right",
                        }}
                      />
                    ) : (
                      <span
                        onClick={() => handlePriceClick(item)}
                        style={{ cursor: "pointer", color: hasError ? "#ef4444" : "#000" }}
                        title="Кликните для редактирования"
                      >
                        {formatPrice(item.price_minor)}
                      </span>
                    )}
                  </td>
                  <td style={rowStyle}>{formatPrice(item.old_price_minor)}</td>
                  <td style={rowStyle}>
                    {isMatched ? (
                      <span style={{ color: "#16a34a", fontWeight: 500 }}>✓ Сопоставлен</span>
                    ) : (
                      <span style={{ color: "#eab308" }}>✗ Не сопоставлен</span>
                    )}
                  </td>
                  <td style={rowStyle}>{formatConfidence(item.confidence)}</td>
                  <td style={rowStyle}>
                    {item.photo_storage_path ? (
                      <a
                        href={getPhotoUrl(item.photo_storage_path) || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={getPhotoUrl(item.photo_storage_path) || undefined}
                          alt={item.raw_name}
                          style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4, cursor: "pointer" }}
                        />
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={rowStyle}>
                    {item.photo_filename
                      ? item.photo_filename.length > 24
                        ? item.photo_filename.slice(0, 10) + "…" + item.photo_filename.slice(-10)
                        : item.photo_filename
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const cellStyle = {
  borderBottom: "1px solid #e5e7eb",
  padding: "0.75rem",
  textAlign: "left" as const,
};