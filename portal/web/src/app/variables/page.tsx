"use client";

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";

interface TenantVariableItem {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly value: string;
  readonly isSecret: boolean;
  readonly usedByCount?: number;
}

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1400px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 18px",
  background: "var(--accent)",
  color: "var(--on-accent)",
  border: "1px solid var(--accent)",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  fontSize: "12px",
  borderRadius: "4px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  cursor: "pointer",
  marginRight: "6px",
};

const tableWrapperStyle: CSSProperties = {
  overflowX: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-soft)",
  fontWeight: 600,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
};

export default function VariablesPage(): ReactElement {
  const [variables, setVariables] = useState<TenantVariableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [val, setVal] = useState("");
  const [isSecret, setIsSecret] = useState(false);

  const fetchVariables = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v1/tenant-variables");
      if (!res.ok) throw new Error("Failed to load variables");
      const data = await res.json();
      setVariables(data.items ?? data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchVariables();
  }, []);

  const handleAddVariable = async (): Promise<void> => {
    if (!name.trim()) return;
    try {
      const res = await fetch("/v1/tenant-variables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          value: val,
          isSecret,
          tenantId: null, // global variable
        }),
      });
      if (!res.ok) throw new Error("Failed to save variable");
      setShowAddModal(false);
      setName("");
      setVal("");
      setIsSecret(false);
      await fetchVariables();
    } catch (err) {
      alert(`Error saving variable: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteVariable = async (id: string, varName: string): Promise<void> => {
    if (!confirm(`Delete variable %${varName}%?`)) return;
    try {
      await fetch(`/v1/tenant-variables/${id}`, { method: "DELETE" });
      await fetchVariables();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div style={pageStyle} data-testid="variables-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Global Variables</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Define reusable parameters for standards templates with automatic masking for secrets.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          style={primaryButtonStyle}
          data-testid="add-variable-btn"
        >
          Add Variable
        </button>
      </div>

      {showAddModal && (
        <div
          style={{
            padding: "20px",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius, 10px)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            boxShadow: "var(--shadow-card)",
          }}
          data-testid="add-variable-form"
        >
          <h3 style={{ margin: 0, fontSize: "16px" }}>New Global Variable</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-soft)" }}>
                Variable Name (%name%)
              </label>
              <input
                type="text"
                placeholder="e.g. BreakGlassAccount"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  padding: "8px 12px",
                  background: "var(--input-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  color: "var(--text)",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                data-testid="var-name-input"
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "var(--text-soft)" }}>
                Value
              </label>
              <input
                type={isSecret ? "password" : "text"}
                placeholder="Value"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                style={{
                  padding: "8px 12px",
                  background: "var(--input-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  color: "var(--text)",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                data-testid="var-value-input"
              />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={isSecret}
              onChange={(e) => setIsSecret(e.target.checked)}
              data-testid="var-secret-checkbox"
            />
            <span>Mark as sensitive secret (masks value in UI)</span>
          </label>

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              style={{ ...actionBtnStyle, padding: "8px 14px" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddVariable}
              style={{ ...primaryButtonStyle, padding: "8px 16px" }}
              data-testid="save-var-btn"
            >
              Save Variable
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-soft)" }}>
          Loading variables...
        </div>
      ) : error ? (
        <div style={{ padding: "16px", background: "var(--danger-soft)", color: "var(--danger-text)", borderRadius: "8px" }}>
          {error}
        </div>
      ) : variables.length === 0 ? (
        <div
          style={{
            padding: "48px 16px",
            textAlign: "center",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius, 10px)",
            color: "var(--text-soft)",
          }}
          data-testid="variables-empty-state"
        >
          No variables defined. Click "Add Variable" to create one.
        </div>
      ) : (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} data-testid="variables-table">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Scope</th>
                <th style={thStyle}>Value</th>
                <th style={thStyle}>Used By</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((v) => (
                <tr key={v.id} data-testid={`variable-row-${v.id}`}>
                  <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                    %{v.name}%
                  </td>
                  <td style={{ ...tdStyle, textTransform: "capitalize" }}>
                    {v.tenantId ? "Tenant" : "Global"}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: v.isSecret ? "var(--font-mono)" : undefined }}>
                    {v.isSecret ? "••••••••" : v.value}
                  </td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                    {v.usedByCount ?? "—"}
                  </td>
                  <td style={tdStyle}>
                    <button type="button" style={actionBtnStyle}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteVariable(v.id, v.name)}
                      style={{ ...actionBtnStyle, color: "var(--danger)" }}
                      data-testid={`delete-var-${v.id}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
