"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Calendar,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  Store,
  BarChart3,
} from "lucide-react";

interface ExportSnapshot {
  id: string;
  snapshot_id: string;
  week: number;
  original_filename: string;
  original_file_size: number;
  snapshot_created_at: string;
  total_price_cells: number;
  filled_price_cells: number;
  coverage_pct: number;
  total_stores: number;
  resolved_stores: number;
  unresolved_stores: number;
  resolvedStores: number;
  totalStores: number;
  unresolvedStores: number;
  filledPriceCells: number;
  totalPriceCells: number;
  coveragePct: number;
  warnings: string[];
  priceData: Record<string, Record<string, number>>;
  catalogIdsByDepartment: Record<string, string[]>;
  triggered_by: string | null;
}

interface StoreCoverage {
  storeLabel: string;
  resolved: boolean;
  filledPriceCells: number;
  totalProductRows: number;
  coveragePct: number;
  lowConfidenceRows: number;
}

export default function ExportSnapshotsPage() {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<ExportSnapshot[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<ExportSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    loadSnapshots();
  }, []);

  const loadSnapshots = async () => {
    try {
      const res = await fetch("/api/price-capture/export-snapshots");
      if (!res.ok) throw new Error("Failed to load snapshots");
      const data = await res.json();
      setSnapshots(data);
    } catch (error) {
      console.error("Error loading snapshots:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getCoverageColor = (pct: number): string => {
    if (pct >= 80) return "#16a34a";
    if (pct >= 50) return "#eab308";
    return "#dc2626";
  };

  const getWarnings = (warnings: string[]): React.ReactNode => {
    if (warnings.length === 0) return null;

    return (
      <div style={{
        marginTop: "1rem",
        padding: "1rem",
        background: "#fef3c7",
        border: "1px solid #fde68a",
        borderRadius: 8,
        fontSize: "0.875rem",
        color: "#92400e",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <AlertTriangle size={16} />
          <strong>Предупреждения:</strong>
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
          {warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      </div>
    );
  };

  const formatPriceData = (priceData: Record<string, Record<string, number>>): string => {
    const entries = Object.entries(priceData).slice(0, 10);
    const rest = Object.entries(priceData).length - 10;
    return entries.map(([catalogId, stores]) => {
      const storeEntries = Object.entries(stores).slice(0, 3);
      const storeStr = storeEntries.map(([storeId, price]) => `${storeId}=${price}`).join(", ");
      return `${catalogId}: {${storeStr}${storeEntries.length < Object.keys(stores).length ? "..." : ""}}`;
    }).join("\n");
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem" }}>
      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button
          onClick={() => router.push("/app/price-capture/export")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#0ea5e9",
          }}
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700 }}>История экспортов</h1>
          <p style={{ margin: "0.25rem 0 0 0", color: "#64748b" }}>
            Сохранённые снапшоты Excel-экспортов с ценами
          </p>
        </div>
      </div>

      {loading ? (
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px",
        }}>
          <div style={{ fontSize: "1.5rem", color: "#64748b" }}>Загрузка...</div>
        </div>
      ) : snapshots.length === 0 ? (
        <div style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: "3rem",
          textAlign: "center",
          color: "#64748b",
        }}>
          <FileText size={48} style={{ marginBottom: "1rem", opacity: 0.4 }} />
          <h2 style={{ marginBottom: "0.5rem" }}>Нет экспортов</h2>
          <p style={{ marginBottom: "1.5rem" }}>
            История сохранённых экспортов появится здесь
          </p>
          <button
            onClick={() => router.push("/app/price-capture/export")}
            style={{
              padding: "0.5rem 1rem",
              background: "#0ea5e9",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Создать экспорт
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1rem",
          }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
              {snapshots.length} экспорт{snapshots.length !== 1 ? "ов" : ""}
            </h2>
          </div>

          {snapshots.map((snapshot) => (
            <div
              key={snapshot.id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "1.5rem",
                background: selectedSnapshot?.id === snapshot.id ? "#f0f9ff" : "#ffffff",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onClick={() => {
                setSelectedSnapshot(snapshot);
                setShowDetails(true);
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                <div style={{
                  padding: "0.75rem",
                  background: "#f8fafc",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <FileText size={24} style={{ color: "#0ea5e9" }} />
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
                      {snapshot.original_filename}
                    </h3>
                    <span style={{
                      padding: "0.25rem 0.75rem",
                      borderRadius: 6,
                      fontSize: "0.75rem",
                      background: "#e2e8f0",
                      color: "#475569",
                      fontWeight: 500,
                    }}>
                      Неделя {snapshot.week}
                    </span>
                    <span style={{
                      padding: "0.25rem 0.75rem",
                      borderRadius: 6,
                      fontSize: "0.75rem",
                      background: "#e2e8f0",
                      color: "#475569",
                      fontWeight: 500,
                    }}>
                      {formatFileSize(snapshot.original_file_size)}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "#64748b", fontSize: "0.875rem" }}>
                      <Calendar size={16} />
                      {formatDate(snapshot.snapshot_created_at)}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "#64748b", fontSize: "0.875rem" }}>
                      <Store size={16} />
                      {snapshot.resolved_stores}/{snapshot.total_stores} магазинов
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "#64748b", fontSize: "0.875rem" }}>
                      <BarChart3 size={16} />
                      Покрытие: {snapshot.coveragePct.toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div style={{
                  padding: "0.5rem",
                  background: getCoverageColor(snapshot.coveragePct),
                  borderRadius: 8,
                  color: "white",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  minWidth: "80px",
                  textAlign: "center",
                }}>
                  {snapshot.coveragePct.toFixed(0)}%
                </div>
              </div>
            </div>
          ))}

          {/* Details panel */}
          {showDetails && selectedSnapshot && (
            <div style={{
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "1.5rem",
              marginTop: "1rem",
              animation: "fadeIn 0.3s ease-in-out",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
                    {selectedSnapshot.original_filename}
                  </h2>
                  <p style={{ margin: "0.5rem 0 0 0", color: "#64748b" }}>
                    Снапшот от {formatDate(selectedSnapshot.snapshot_created_at)}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    onClick={() => {
                      // TODO: Implement download from snapshot
                      alert("Функция загрузки снапшота будет доступна в следующей версии");
                    }}
                    style={{
                      padding: "0.75rem 1.5rem",
                      background: "#0ea5e9",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <Download size={16} />
                    Скачать Excel
                  </button>
                  <button
                    onClick={() => {
                      setSelectedSnapshot(null);
                      setShowDetails(false);
                    }}
                    style={{
                      padding: "0.75rem 1rem",
                      background: "#f1f5f9",
                      color: "#475569",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                    }}
                  >
                    Закрыть
                  </button>
                </div>
              </div>

              {/* Coverage stats */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "1rem",
                marginBottom: "1.5rem",
              }}>
                <div style={{
                  padding: "1rem",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}>
                  <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>
                    Покрытие цен
                  </div>
                  <div style={{
                    fontSize: "2rem",
                    fontWeight: 700,
                    color: getCoverageColor(selectedSnapshot.coveragePct),
                  }}>
                    {selectedSnapshot.coveragePct.toFixed(1)}%
                  </div>
                </div>

                <div style={{
                  padding: "1rem",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}>
                  <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>
                    Заполнено ячеек
                  </div>
                  <div style={{
                    fontSize: "2rem",
                    fontWeight: 700,
                    color: "#475569",
                  }}>
                    {selectedSnapshot.filledPriceCells}
                    <span style={{ fontSize: "1rem", fontWeight: 500, color: "#94a3b8", marginLeft: "0.5rem" }}>
                      / {selectedSnapshot.totalPriceCells}
                    </span>
                  </div>
                </div>

                <div style={{
                  padding: "1rem",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}>
                  <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>
                    Магазины
                  </div>
                  <div style={{
                    fontSize: "2rem",
                    fontWeight: 700,
                    color: "#475569",
                  }}>
                    {selectedSnapshot.resolvedStores}
                    <span style={{ fontSize: "1rem", fontWeight: 500, color: "#94a3b8", marginLeft: "0.5rem" }}>
                      / {selectedSnapshot.totalStores}
                    </span>
                  </div>
                </div>

                <div style={{
                  padding: "1rem",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}>
                  <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>
                    Несопоставлено
                  </div>
                  <div style={{
                    fontSize: "2rem",
                    fontWeight: 700,
                    color: selectedSnapshot.unresolvedStores > 0 ? "#dc2626" : "#16a34a",
                  }}>
                    {selectedSnapshot.unresolvedStores}
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {getWarnings(selectedSnapshot.warnings)}

              {/* Price data preview */}
              <div style={{ marginTop: "1.5rem" }}>
                <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
                  Данные о ценах (превью)
                </h3>
                <div style={{
                  padding: "1rem",
                  background: "#f8fafc",
                  borderRadius: 8,
                  fontSize: "0.875rem",
                  fontFamily: "monospace",
                  maxHeight: "300px",
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                  color: "#475569",
                }}>
                  {formatPriceData(selectedSnapshot.priceData as Record<string, Record<string, number>>)}
                  {Object.keys(selectedSnapshot.priceData).length > 10 && (
                    <span style={{ color: "#64748b" }}>
                      \n... и ещё {Object.keys(selectedSnapshot.priceData).length - 10} записей
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
