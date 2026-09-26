"use client";

// GroupsTable — Groups data table with filters, type badges, row actions, and detail drawer
// (EPIC-014 SPEC.md §3.1; T-0263).
import React, { useMemo, useState, type CSSProperties } from "react";
import type { GroupItem, GroupType } from "../../lib/groupsApi";
import { GroupDetailDrawer } from "./GroupDetailDrawer";

export type GroupRowAction =
  | "view"
  | "edit"
  | "manageMembers"
  | "manageOwners"
  | "gal"
  | "delivery"
  | "delete"
  | "convert";

export interface GroupsTableProps {
  readonly groups?: readonly GroupItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onAddGroup?: () => void;
  readonly onAction?: (action: GroupRowAction, group: GroupItem) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const headerBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const filterRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--primary, #2563eb)",
  color: "var(--primary-contrast, #ffffff)",
  border: "none",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  fontSize: "12px",
  cursor: "pointer",
  color: "var(--text)",
};

const tableWrapperStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  background: "var(--bg-elev)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
};

export function getTypeBadgeStyle(type: GroupType): CSSProperties {
  let bg = "var(--surface)";
  let color = "var(--text)";
  switch (type) {
    case "m365":
      bg = "rgba(59, 130, 246, 0.15)";
      color = "#2563eb";
      break;
    case "dynamic":
      bg = "rgba(168, 85, 247, 0.15)";
      color = "#9333ea";
      break;
    case "distribution":
      bg = "rgba(16, 185, 129, 0.15)";
      color = "#059669";
      break;
    case "mailEnabledSecurity":
      bg = "rgba(245, 158, 11, 0.15)";
      color = "#d97706";
      break;
    case "security":
    default:
      bg = "rgba(107, 114, 128, 0.15)";
      color = "var(--text-muted, #4b5563)";
      break;
  }
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "12px",
    fontSize: "12px",
    fontWeight: 600,
    backgroundColor: bg,
    color,
    textTransform: "capitalize",
  };
}

export function GroupsTable({
  groups = [],
  loading = false,
  error = null,
  onAddGroup,
  onAction,
}: GroupsTableProps): React.ReactElement {
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Filters state
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [hiddenFilter, setHiddenFilter] = useState<string>("all");
  const [dynamicFilter, setDynamicFilter] = useState<string>("all");
  const [sizeFilter, setSizeFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      if (typeFilter !== "all" && g.type.toLowerCase() !== typeFilter.toLowerCase()) {
        return false;
      }
      if (hiddenFilter === "true" && !g.hiddenFromAddressListsEnabled) {
        return false;
      }
      if (hiddenFilter === "false" && g.hiddenFromAddressListsEnabled) {
        return false;
      }
      if (dynamicFilter === "true" && !g.isDynamic) {
        return false;
      }
      if (dynamicFilter === "false" && g.isDynamic) {
        return false;
      }
      if (sizeFilter !== "all") {
        if (sizeFilter === "empty" && g.membershipCount !== 0) return false;
        if (sizeFilter === "small" && (g.membershipCount < 1 || g.membershipCount > 10)) return false;
        if (sizeFilter === "medium" && (g.membershipCount < 11 || g.membershipCount > 50)) return false;
        if (sizeFilter === "large" && g.membershipCount <= 50) return false;
      }
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matched =
          g.name.toLowerCase().includes(term) ||
          (g.mail && g.mail.toLowerCase().includes(term)) ||
          (g.description && g.description.toLowerCase().includes(term));
        if (!matched) return false;
      }
      return true;
    });
  }, [groups, typeFilter, hiddenFilter, dynamicFilter, sizeFilter, searchTerm]);

  const handleAction = (action: GroupRowAction, group: GroupItem) => {
    if (action === "view") {
      setSelectedGroup(group);
      setDrawerOpen(true);
    }
    onAction?.(action, group);
  };

  return (
    <div style={containerStyle} data-testid="groups-table-container">
      {/* Header bar with filters and Add group button */}
      <div style={headerBarStyle}>
        <div style={filterRowStyle}>
          <input
            type="search"
            placeholder="Search groups..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ ...inputStyle, width: "200px" }}
            data-testid="filter-search"
          />

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={selectStyle}
            data-testid="filter-type"
          >
            <option value="all">All types</option>
            <option value="m365">M365</option>
            <option value="security">Security</option>
            <option value="distribution">Distribution</option>
            <option value="mailEnabledSecurity">Mail-enabled Security</option>
            <option value="dynamic">Dynamic</option>
          </select>

          <select
            value={hiddenFilter}
            onChange={(e) => setHiddenFilter(e.target.value)}
            style={selectStyle}
            data-testid="filter-hidden"
          >
            <option value="all">All GAL states</option>
            <option value="true">Hidden from GAL</option>
            <option value="false">Visible in GAL</option>
          </select>

          <select
            value={dynamicFilter}
            onChange={(e) => setDynamicFilter(e.target.value)}
            style={selectStyle}
            data-testid="filter-dynamic"
          >
            <option value="all">All membership types</option>
            <option value="true">Dynamic only</option>
            <option value="false">Assigned only</option>
          </select>

          <select
            value={sizeFilter}
            onChange={(e) => setSizeFilter(e.target.value)}
            style={selectStyle}
            data-testid="filter-size"
          >
            <option value="all">All sizes</option>
            <option value="empty">Empty (0)</option>
            <option value="small">Small (1-10)</option>
            <option value="medium">Medium (11-50)</option>
            <option value="large">Large (50+)</option>
          </select>
        </div>

        {onAddGroup && (
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={onAddGroup}
            data-testid="add-group-btn"
          >
            Add group
          </button>
        )}
      </div>

      {loading && <div data-testid="groups-loading">Loading groups...</div>}
      {error && <div data-testid="groups-error" style={{ color: "var(--danger)" }}>{error}</div>}

      {/* Table */}
      <div style={tableWrapperStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Membership</th>
              <th style={thStyle}>Owners</th>
              <th style={thStyle}>Hidden from GAL</th>
              <th style={thStyle}>Delivery mgmt</th>
              <th style={thStyle}>Dynamic rule</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "var(--text-muted)" }}>
                  No groups match criteria
                </td>
              </tr>
            ) : (
              filteredGroups.map((group) => (
                <tr key={group.id} data-testid={`group-row-${group.id}`}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{group.name}</div>
                    {group.mail && (
                      <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{group.mail}</div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span style={getTypeBadgeStyle(group.type)} data-testid={`badge-type-${group.id}`}>
                      {group.type}
                    </span>
                  </td>
                  <td style={tdStyle}>{group.membershipCount}</td>
                  <td style={tdStyle}>{group.ownerCount}</td>
                  <td style={tdStyle}>
                    {group.hiddenFromAddressListsEnabled ? (
                      <span style={{ color: "var(--warning, #d97706)" }}>Yes</span>
                    ) : (
                      "No"
                    )}
                  </td>
                  <td style={tdStyle}>
                    {group.deliveryManagementEnabled ? "Enabled" : "Default"}
                  </td>
                  <td style={tdStyle}>
                    {group.dynamicRule ? (
                      <code style={{ fontSize: "12px", background: "var(--surface)", padding: "2px 6px", borderRadius: "4px" }}>
                        {group.dynamicRule}
                      </code>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => handleAction("view", group)}
                        data-testid={`action-view-${group.id}`}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => handleAction("edit", group)}
                        data-testid={`action-edit-${group.id}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => handleAction("manageMembers", group)}
                        data-testid={`action-manageMembers-${group.id}`}
                      >
                        Manage members
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => handleAction("manageOwners", group)}
                        data-testid={`action-manageOwners-${group.id}`}
                      >
                        Manage owners
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => handleAction("gal", group)}
                        data-testid={`action-gal-${group.id}`}
                      >
                        Hide from GAL
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => handleAction("delivery", group)}
                        data-testid={`action-delivery-${group.id}`}
                      >
                        Delivery management
                      </button>
                      <button
                        type="button"
                        style={{ ...actionBtnStyle, color: "var(--danger, #dc2626)" }}
                        onClick={() => handleAction("delete", group)}
                        data-testid={`action-delete-${group.id}`}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => handleAction("convert", group)}
                        data-testid={`action-convert-${group.id}`}
                      >
                        Convert
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <GroupDetailDrawer
        group={selectedGroup}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedGroup(null);
        }}
      />
    </div>
  );
}
