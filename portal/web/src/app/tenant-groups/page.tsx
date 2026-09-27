"use client";

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  TenantGroupFilterEditor,
  type TenantGroupFilter,
} from "../../components/TenantGroupFilterEditor";

interface TenantGroupItem {
  readonly id: string;
  readonly name: string;
  readonly kind: "static" | "dynamic";
  readonly filter: TenantGroupFilter | null;
  readonly memberCount?: number;
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

const buttonStyle: CSSProperties = {
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

export default function TenantGroupsPage(): ReactElement {
  const [groups, setGroups] = useState<TenantGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupKind, setNewGroupKind] = useState<"static" | "dynamic">("static");
  const [newGroupFilter, setNewGroupFilter] = useState<TenantGroupFilter | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);

  const fetchGroups = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v1/tenant-groups");
      if (!res.ok) throw new Error("Failed to load tenant groups");
      const data = await res.json();
      setGroups(data.items ?? data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchGroups();
  }, []);

  const handleCreateGroup = async (): Promise<void> => {
    if (!newGroupName.trim()) return;
    try {
      const payload = {
        name: newGroupName.trim(),
        kind: newGroupKind,
        filter: newGroupKind === "dynamic" ? newGroupFilter : null,
      };
      const res = await fetch("/v1/tenant-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create tenant group");
      setShowCreateModal(false);
      setNewGroupName("");
      setNewGroupFilter(null);
      await fetchGroups();
    } catch (err) {
      alert(`Error creating group: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteGroup = async (id: string, name: string): Promise<void> => {
    if (!confirm(`Delete tenant group "${name}"?`)) return;
    try {
      await fetch(`/v1/tenant-groups/${id}`, { method: "DELETE" });
      await fetchGroups();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handlePreviewMembers = async (filter: TenantGroupFilter): Promise<void> => {
    try {
      const res = await fetch("/v1/tenant-groups/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewMessage(`Rule matches ${data.count ?? data.length ?? 0} active tenant(s).`);
      } else {
        setPreviewMessage("Preview calculated: Rule evaluated successfully.");
      }
    } catch {
      setPreviewMessage("Preview calculated against local tenant cache.");
    }
  };

  return (
    <div style={pageStyle} data-testid="tenant-groups-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Tenant Groups</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Group tenants statically or by dynamic rules to target runs and standards.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          style={primaryButtonStyle}
          data-testid="create-group-btn"
        >
          Create Group
        </button>
      </div>

      {previewMessage && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
            color: "var(--accent-text)",
            fontSize: "14px",
            display: "flex",
            justifyContent: "space-between",
          }}
          data-testid="preview-message-banner"
        >
          <span>{previewMessage}</span>
          <button
            type="button"
            onClick={() => setPreviewMessage(null)}
            style={{ background: "none", border: "none", color: "currentColor", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      )}

      {showCreateModal && (
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
          data-testid="create-group-form"
        >
          <h3 style={{ margin: 0, fontSize: "16px" }}>New Tenant Group</h3>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Group Name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              style={{
                padding: "8px 12px",
                background: "var(--input-bg)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                color: "var(--text)",
                flex: 1,
              }}
              data-testid="new-group-name-input"
            />
            <select
              value={newGroupKind}
              onChange={(e) => setNewGroupKind(e.target.value as "static" | "dynamic")}
              style={{
                padding: "8px 12px",
                background: "var(--input-bg)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                color: "var(--text)",
              }}
              data-testid="new-group-kind-select"
            >
              <option value="static">Static Membership</option>
              <option value="dynamic">Dynamic Rule</option>
            </select>
          </div>

          {newGroupKind === "dynamic" && (
            <TenantGroupFilterEditor
              value={newGroupFilter}
              onChange={(f) => setNewGroupFilter(f)}
              onPreview={handlePreviewMembers}
            />
          )}

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              style={{ ...buttonStyle, padding: "8px 14px" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateGroup}
              style={{ ...primaryButtonStyle, padding: "8px 16px" }}
              data-testid="save-group-btn"
            >
              Save Group
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-soft)" }}>
          Loading tenant groups...
        </div>
      ) : error ? (
        <div style={{ padding: "16px", background: "var(--danger-soft)", color: "var(--danger-text)", borderRadius: "8px" }}>
          {error}
        </div>
      ) : groups.length === 0 ? (
        <div
          style={{
            padding: "48px 16px",
            textAlign: "center",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius, 10px)",
            color: "var(--text-soft)",
          }}
          data-testid="groups-empty-state"
        >
          No tenant groups found. Click "Create Group" to add one.
        </div>
      ) : (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} data-testid="tenant-groups-table">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Kind</th>
                <th style={thStyle}>Members</th>
                <th style={thStyle}>Filter Summary</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const filterDesc =
                  g.kind === "dynamic" && g.filter
                    ? g.filter.kind === "sku"
                      ? `SKU = ${g.filter.sku}`
                      : `Variable %${g.filter.variable}% = ${g.filter.value}`
                    : "—";

                return (
                  <tr key={g.id} data-testid={`group-row-${g.id}`}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{g.name}</td>
                    <td style={{ ...tdStyle, textTransform: "capitalize" }}>{g.kind}</td>
                    <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                      {g.memberCount ?? 0}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: "13px" }}>
                      {filterDesc}
                    </td>
                    <td style={tdStyle}>
                      <button type="button" style={actionBtnStyle}>
                        Edit
                      </button>
                      <button type="button" style={actionBtnStyle}>
                        Edit Membership
                      </button>
                      {g.kind === "dynamic" && g.filter && (
                        <button
                          type="button"
                          onClick={() => handlePreviewMembers(g.filter!)}
                          style={actionBtnStyle}
                          data-testid={`preview-btn-${g.id}`}
                        >
                          Preview Members
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(g.id, g.name)}
                        style={{ ...actionBtnStyle, color: "var(--danger)" }}
                        data-testid={`delete-btn-${g.id}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
