"use client";

// Groups page — Identity Management -> Administration -> Groups (EPIC-014 SPEC.md §3.1; T-0263).
import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GroupsTable, type GroupRowAction } from "../../../components/groups/GroupsTable";
import { listGroups, type GroupItem } from "../../../lib/groupsApi";

export default function GroupsPage(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenantId") || "default-tenant";

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchGroups() {
      try {
        setLoading(true);
        setError(null);
        const data = await listGroups(tenantId);
        if (active) {
          setGroups([...data.items]);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || "Failed to load groups");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    fetchGroups();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const handleAction = (action: GroupRowAction, group: GroupItem) => {
    switch (action) {
      case "edit":
        router.push(`/identity/groups/${group.id}/edit?tenantId=${encodeURIComponent(tenantId)}`);
        break;
      case "manageMembers":
      case "manageOwners":
        router.push(`/identity/groups/${group.id}/bulk?tenantId=${encodeURIComponent(tenantId)}`);
        break;
      case "delete":
        // delete handled via dialog or direct
        break;
      default:
        break;
    }
  };

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
          Identity Management &gt; Administration &gt; Groups
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Groups</h1>
      </div>

      <GroupsTable
        groups={groups}
        loading={loading}
        error={error}
        onAddGroup={() => router.push(`/identity/groups/new?tenantId=${encodeURIComponent(tenantId)}`)}
        onAction={handleAction}
      />
    </div>
  );
}
