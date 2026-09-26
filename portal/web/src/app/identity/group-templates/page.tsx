"use client";

// Group Templates Page — Identity Management -> Administration -> Group Templates (EPIC-014 SPEC.md §3.2; T-0267).
import React, { useEffect, useState } from "react";
import { GroupTemplateTable } from "../../../components/groups/GroupTemplateTable";
import {
  createGroupTemplate,
  deleteGroupTemplate,
  listGroupTemplates,
  updateGroupTemplate,
  type GroupTemplate,
} from "../../../lib/groupsApi";

export default function GroupTemplatesPage(): React.ReactElement {
  const [templates, setTemplates] = useState<GroupTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listGroupTemplates();
      setTemplates([...data.items]);
    } catch (err: any) {
      setError(err.message || "Failed to load group templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleCreate = async (data: Partial<GroupTemplate>) => {
    await createGroupTemplate(data);
    await fetchTemplates();
  };

  const handleUpdate = async (id: string, data: Partial<GroupTemplate>) => {
    await updateGroupTemplate(id, data);
    await fetchTemplates();
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this template?")) {
      await deleteGroupTemplate(id);
      await fetchTemplates();
    }
  };

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
          Identity Management &gt; Administration &gt; Group Templates
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Group Templates</h1>
      </div>

      <GroupTemplateTable
        templates={templates}
        loading={loading}
        error={error}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}
