"use client";

// Policy Templates page — EPIC-016 SPEC.md §3.2; T-0307.
// Nav: Intune → Device Management → Policy Templates.
import React, { useCallback, useEffect, useState } from "react";
import {
  createIntuneTemplate,
  deleteIntuneTemplate,
  listDeployTargets,
  listIntuneTemplates,
  updateIntuneTemplate,
  type DeployTenantGroupOption,
  type DeployTenantOption,
  type IntuneTemplate,
} from "../../../lib/intuneApi";
import {
  IntuneTemplateEditDialog,
  IntuneTemplateTable,
  type IntuneTemplateRowAction,
} from "../../../components/intune/IntuneTemplateTable";
import { IntuneDeployDrawer } from "../../../components/intune/IntuneDeployDrawer";

function downloadJson(fileName: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function IntuneTemplatesPage() {
  const [templates, setTemplates] = useState<IntuneTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tenants, setTenants] = useState<DeployTenantOption[]>([]);
  const [tenantGroups, setTenantGroups] = useState<DeployTenantGroupOption[]>([]);
  const [deploying, setDeploying] = useState<{ templateId: string | null } | null>(null);
  const [editing, setEditing] = useState<IntuneTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all: IntuneTemplate[] = [];
      let cursor: string | null = null;
      do {
        const page = await listIntuneTemplates({ cursor, limit: 100 });
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setTemplates(all);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load policy templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    listDeployTargets()
      .then(({ tenants: t, groups }) => {
        setTenants(t);
        setTenantGroups(groups);
      })
      .catch((err: unknown) =>
        setNotice(err instanceof Error ? `Deploy targets unavailable: ${err.message}` : "Deploy targets unavailable."),
      );
  }, [load]);

  async function handleAction(action: IntuneTemplateRowAction, template: IntuneTemplate) {
    setNotice(null);
    try {
      switch (action) {
        case "deploy":
          setDeploying({ templateId: template.id });
          return;
        case "edit":
          setEditing(template);
          return;
        case "clone":
          await createIntuneTemplate({
            name: `${template.name} (Copy)`,
            platform: template.platform,
            policyType: template.policyType,
            policyJson: template.policyJson,
            assignments: template.assignments,
          });
          await load();
          return;
        case "export":
          downloadJson(`${template.name.replace(/[^\w.-]+/g, "_")}.json`, JSON.stringify(template, null, 2));
          return;
        case "delete":
          if (!window.confirm(`Delete the template '${template.name}'?`)) return;
          await deleteIntuneTemplate(template.id);
          await load();
          return;
      }
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : `Failed to ${action} template.`);
    }
  }

  return (
    <main style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {notice && (
        <div
          role="status"
          style={{ marginBottom: "16px", padding: "12px 16px", border: "1px solid var(--border, #e5e7eb)", borderRadius: "8px" }}
        >
          {notice}
        </div>
      )}
      <IntuneTemplateTable
        templates={templates}
        loading={loading}
        error={error}
        onAction={(action, template) => void handleAction(action, template)}
        onDeploy={() => setDeploying({ templateId: null })}
      />
      {deploying && (
        <IntuneDeployDrawer
          templates={templates}
          initialTemplateId={deploying.templateId}
          tenants={tenants}
          tenantGroups={tenantGroups}
          onClose={() => setDeploying(null)}
        />
      )}
      {editing && (
        <IntuneTemplateEditDialog
          template={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await updateIntuneTemplate(editing.id, patch);
            await load();
          }}
        />
      )}
    </main>
  );
}
