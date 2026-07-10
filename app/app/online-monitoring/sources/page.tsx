"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Zap,
  Globe,
  Settings,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface Source {
  id: string;
  source_key: string;
  display_name: string;
  base_url: string | null;
  enabled: boolean;
  legal_status: "pending" | "allowed" | "blocked";
  rate_limit_per_minute: number | null;
  parser_config: Record<string, unknown> | null;
  source_stores: SourceStore[];
  last_run_at: string | null;
  last_run_status: string | null;
}

interface SourceStore {
  source_store_id: string;
  source_city: string | null;
  source_address: string | null;
  store_id: string | null;
  store_name: string | null;
}

export default function OnlineSourceManagementPage() {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  // Load sources
  const loadSources = useCallback(async () => {
    try {
      const res = await fetch("/api/online-monitoring/sources");
      if (!res.ok) throw new Error("Failed to load sources");
      const data = await res.json();
      setSources(data);
    } catch (error) {
      console.error("Error loading sources:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const toggleExpand = (sourceId: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const updateSource = async (sourceId: string, updates: Partial<Source>) => {
    setSaving(prev => ({ ...prev, [sourceId]: true }));
    try {
      const res = await fetch(`/api/online-monitoring/sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) throw new Error("Failed to update source");

      // Update local state
      setSources(prev => prev.map(s =>
        s.id === sourceId ? { ...s, ...updates } : s
      ));

      // Refresh if needed
      await loadSources();
    } catch (error) {
      console.error("Error updating source:", error);
      alert("Failed to update source");
    } finally {
      setSaving(prev => ({ ...prev, [sourceId]: false }));
    }
  };

  const enableSource = async (sourceId: string) => {
    await updateSource(sourceId, { enabled: true, legal_status: "allowed" });
  };

  const disableSource = async (sourceId: string) => {
    await updateSource(sourceId, { enabled: false });
  };

  const setLegalStatus = async (sourceId: string, status: "pending" | "allowed" | "blocked") => {
    await updateSource(sourceId, { legal_status: status });
  };

  const updateRateLimit = async (sourceId: string, value: number | null) => {
    await updateSource(sourceId, { rate_limit_per_minute: value });
  };

  const updateStore = async (sourceId: string, storeIndex: number, updates: Partial<SourceStore>) => {
    const updatedStores = [...sources.find(s => s.id === sourceId)!.source_stores];
    updatedStores[storeIndex] = { ...updatedStores[storeIndex], ...updates };
    await updateSource(sourceId, { source_stores: updatedStores });
  };

  const addStore = async (sourceId: string) => {
    const updatedStores = [
      ...sources.find(s => s.id === sourceId)!.source_stores,
      {
        source_store_id: "",
        source_city: "",
        source_address: "",
        store_id: "",
        store_name: "",
      },
    ];
    await updateSource(sourceId, { source_stores: updatedStores });
  };

  const removeStore = async (sourceId: string, storeIndex: number) => {
    const updatedStores = sources.find(s => s.id === sourceId)!.source_stores.filter((_, i) => i !== storeIndex);
    await updateSource(sourceId, { source_stores: updatedStores });
  };

  const getLegalStatusBadge = (status: "pending" | "allowed" | "blocked") => {
    const styles = {
      pending: { bg: "#fef3c7", text: "#92400e", label: "Ожидает проверки", icon: AlertTriangle },
      allowed: { bg: "#dcfce7", text: "#166534", label: "Разрешён", icon: CheckCircle },
      blocked: { bg: "#fee2e2", text: "#991b1b", label: "Запрещён", icon: XCircle },
    };
    const s = styles[status];
    const Icon = s.icon;
    return (
      <span style={{
        padding: "0.25rem 0.75rem",
        borderRadius: 6,
        fontSize: "0.75rem",
        background: s.bg,
        color: s.text,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
      }}>
        <Icon size={12} />
        {s.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "400px",
      }}>
        <div style={{ fontSize: "1.5rem", color: "#64748b" }}>Загрузка...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem" }}>
      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <button
          onClick={() => router.push("/app/online-monitoring")}
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
          <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700 }}>Управление источниками</h1>
          <p style={{ margin: "0.25rem 0 0 0", color: "#64748b" }}>Настройка парсеров, магазинов и ограничений</p>
        </div>
      </div>

      {sources.length === 0 ? (
        <div style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: "3rem",
          textAlign: "center",
          color: "#64748b",
        }}>
          <Settings size={48} style={{ marginBottom: "1rem", opacity: 0.4 }} />
          <h2 style={{ marginBottom: "0.5rem" }}>Нет источников</h2>
          <p style={{ marginBottom: "1.5rem" }}>Сначала добавьте онлайн-источник в настройках компании</p>
          <button
            onClick={() => router.push("/app/online-monitoring")}
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
            Перейти к источникам
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {sources.map((source) => (
            <div
              key={source.id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: "1rem 1.5rem",
                  background: "#f8fafc",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
                <button
                  onClick={() => toggleExpand(source.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    color: "#64748b",
                  }}
                >
                  {expandedSources.has(source.id) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </button>

                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>{source.display_name}</h3>
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>{source.source_key}</span>
                  </div>
                  {source.base_url && (
                    <a
                      href={source.base_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#0ea5e9",
                        fontSize: "0.875rem",
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                      }}
                    >
                      {source.base_url}
                      <Globe size={14} />
                    </a>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                  {getLegalStatusBadge(source.legal_status)}
                  <span style={{
                    padding: "0.25rem 0.75rem",
                    borderRadius: 6,
                    fontSize: "0.75rem",
                    background: source.enabled ? "#dcfce7" : "#e2e8f0",
                    color: source.enabled ? "#166534" : "#64748b",
                    fontWeight: 600,
                  }}>
                    {source.enabled ? "Включён" : "Отключён"}
                  </span>
                </div>
              </div>

              {/* Expanded Content */}
              {expandedSources.has(source.id) && (
                <div style={{ padding: "1.5rem" }}>
                  <div style={{ display: "grid", gap: "1.5rem" }}>
                    {/* Status & Actions */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "#475569" }}>Статус</label>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          {source.enabled ? (
                            <button
                              onClick={() => disableSource(source.id)}
                              disabled={saving[source.id]}
                              style={{
                                padding: "0.5rem 1rem",
                                background: "#fee2e2",
                                color: "#991b1b",
                                border: "none",
                                borderRadius: 6,
                                cursor: "pointer",
                                fontSize: "0.875rem",
                                fontWeight: 500,
                              }}
                            >
                              Отключить
                            </button>
                          ) : (
                            <button
                              onClick={() => enableSource(source.id)}
                              disabled={saving[source.id] || source.legal_status !== "allowed"}
                              style={{
                                padding: "0.5rem 1rem",
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
                              <Zap size={16} />
                              Включить
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "#475569" }}>Ограничение rate limit</label>
                        <input
                          type="number"
                          value={source.rate_limit_per_minute ?? ""}
                          onChange={(e) => updateRateLimit(source.id, e.target.value ? Number(e.target.value) : null)}
                          style={{
                            padding: "0.5rem",
                            borderRadius: 6,
                            border: "1px solid #e2e8f0",
                            fontSize: "0.875rem",
                          }}
                          min="1"
                          max="1000"
                        />
                        <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          Запросов в минуту. Оставьте пустым для неограниченного.
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "#475569" }}>Последний запуск</label>
                        <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                          {source.last_run_at ? new Date(source.last_run_at).toLocaleString("ru-RU") : "—"}
                        </div>
                        {source.last_run_status === "failed" && (
                          <span style={{ fontSize: "0.75rem", color: "#dc2626" }}>Ошибка</span>
                        )}
                      </div>
                    </div>

                    {/* Legal Status */}
                    <div style={{ padding: "1rem", background: "#f8fafc", borderRadius: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                        <Shield size={20} style={{ color: "#64748b" }} />
                        <h4 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#475569" }}>
                          Правовой статус
                        </h4>
                      </div>

                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        {(["pending", "allowed", "blocked"] as const).map((status) => (
                          <button
                            key={status}
                            onClick={() => setLegalStatus(source.id, status)}
                            disabled={saving[source.id]}
                            style={{
                              padding: "0.5rem 1rem",
                              borderRadius: 6,
                              border: "1px solid #e2e8f0",
                              background: source.legal_status === status ? "#f1f5f9" : "white",
                              color: source.legal_status === status ? "#0ea5e9" : "#64748b",
                              cursor: "pointer",
                              fontSize: "0.875rem",
                              fontWeight: 500,
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            {status === "pending" && <AlertTriangle size={16} />}
                            {status === "allowed" && <CheckCircle size={16} />}
                            {status === "blocked" && <XCircle size={16} />}
                            {status === "pending" ? "Ожидает" : status === "allowed" ? "Разрешён" : "Запрещён"}
                          </button>
                        ))}
                      </div>

                      {source.legal_status === "pending" && (
                        <div style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#64748b" }}>
                          ⚠️ Источник не включён до проверки правового статуса. Отметьте &quot;Разрешён&quot; только после подтверждения,
                          что парсинг разрешён правилами сайта.
                        </div>
                      )}
                    </div>

                    {/* Store Mapping */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                        <Settings size={20} style={{ color: "#64748b" }} />
                        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "#475569" }}>
                          Сопоставление магазинов
                        </h3>
                      </div>

                      {source.source_stores.length === 0 ? (
                        <div style={{ padding: "1rem", background: "#f8fafc", borderRadius: 8, color: "#64748b" }}>
                          Магазины не настроены. Добавьте хотя бы один магазин для парсинга.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {source.source_stores.map((store, index) => (
                            <div
                              key={index}
                              style={{
                                padding: "1rem",
                                background: "#f8fafc",
                                borderRadius: 8,
                                border: "1px solid #e2e8f0",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                                    <span style={{
                                      padding: "0.25rem 0.75rem",
                                      borderRadius: 6,
                                      fontSize: "0.75rem",
                                      background: "#e2e8f0",
                                      color: "#475569",
                                      fontWeight: 600,
                                    }}>
                                      Магазин {index + 1}
                                    </span>
                                  </div>

                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "0.75rem" }}>
                                    <div>
                                      <label style={{ fontSize: "0.875rem", color: "#64748b", display: "block", marginBottom: "0.25rem" }}>
                                        ID магазина в источнике
                                      </label>
                                      <input
                                        type="text"
                                        value={store.source_store_id}
                                        onChange={(e) => updateStore(source.id, index, { source_store_id: e.target.value })}
                                        style={{
                                          width: "100%",
                                          padding: "0.5rem",
                                          borderRadius: 6,
                                          border: "1px solid #e2e8f0",
                                          fontSize: "0.875rem",
                                        }}
                                      />
                                    </div>

                                    <div>
                                      <label style={{ fontSize: "0.875rem", color: "#64748b", display: "block", marginBottom: "0.25rem" }}>
                                        Город
                                      </label>
                                      <input
                                        type="text"
                                        value={store.source_city ?? ""}
                                        onChange={(e) => updateStore(source.id, index, { source_city: e.target.value || null })}
                                        style={{
                                          width: "100%",
                                          padding: "0.5rem",
                                          borderRadius: 6,
                                          border: "1px solid #e2e8f0",
                                          fontSize: "0.875rem",
                                        }}
                                      />
                                    </div>

                                    <div>
                                      <label style={{ fontSize: "0.875rem", color: "#64748b", display: "block", marginBottom: "0.25rem" }}>
                                        Адрес
                                      </label>
                                      <input
                                        type="text"
                                        value={store.source_address ?? ""}
                                        onChange={(e) => updateStore(source.id, index, { source_address: e.target.value || null })}
                                        style={{
                                          width: "100%",
                                          padding: "0.5rem",
                                          borderRadius: 6,
                                          border: "1px solid #e2e8f0",
                                          fontSize: "0.875rem",
                                        }}
                                      />
                                    </div>

                                    <div>
                                      <label style={{ fontSize: "0.875rem", color: "#64748b", display: "block", marginBottom: "0.25rem" }}>
                                        Наш ID магазина
                                      </label>
                                      <input
                                        type="text"
                                        value={store.store_id ?? ""}
                                        onChange={(e) => updateStore(source.id, index, { store_id: e.target.value || null })}
                                        style={{
                                          width: "100%",
                                          padding: "0.5rem",
                                          borderRadius: 6,
                                          border: "1px solid #e2e8f0",
                                          fontSize: "0.875rem",
                                        }}
                                      />
                                    </div>
                                  </div>

                                  {store.store_name && (
                                    <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#166534" }}>
                                      ✓ Связь: {store.store_name}
                                    </div>
                                  )}
                                </div>

                                {source.source_stores.length > 1 && (
                                  <button
                                    onClick={() => removeStore(source.id, index)}
                                    disabled={saving[source.id]}
                                    style={{
                                      padding: "0.5rem",
                                      background: "none",
                                      border: "none",
                                      color: "#dc2626",
                                      cursor: "pointer",
                                      fontSize: "0.875rem",
                                    }}
                                  >
                                    Удалить
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}

                          <button
                            onClick={() => addStore(source.id)}
                            disabled={saving[source.id]}
                            style={{
                              padding: "0.75rem 1rem",
                              background: "#f8fafc",
                              color: "#0ea5e9",
                              border: "1px dashed #e2e8f0",
                              borderRadius: 6,
                              cursor: "pointer",
                              fontSize: "0.875rem",
                              fontWeight: 500,
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            <Settings size={16} />
                            Добавить магазин
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
