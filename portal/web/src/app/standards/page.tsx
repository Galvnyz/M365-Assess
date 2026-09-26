"use client";

// Standards Templates page (EPIC-008 SPEC.md §3.1, T-0146).
// Title "Standards Templates", a Create template primary button, and the
// TemplatesTable wired to the T-0143 endpoints. Row actions that need later
// endpoints (Run template now / Set schedule -> T-0150, drift clone -> EPIC-009,
// Save to GitHub -> EPIC-039) are rendered and call the client, which hits the
// documented SPEC §6 paths. Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { TemplatesTable, type StandardsTemplateItem } from "../../components/standards/TemplatesTable.js";
import {
  cloneStandardTemplate,
  convertStandardTemplate,
  createDriftClone,
  deleteStandardTemplate,
  fetchStandardTemplates,
  kindLabel,
  runStandardTemplateNow,
  setStandardTemplateSchedule,
  type StandardTemplate,
  type StandardTemplateKind,
} from "../../lib/standardsApi.js";

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
  alignItems: "flex-start",
  gap: "16px",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
  flexWrap: "wrap",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const noticeStyle: CSSProperties = {
  padding: "10px 14px",
  background: "var(--accent-soft)",
  border: "1px solid var(--accent)",
  borderRadius: "6px",
  color: "var(--accent-text)",
  fontSize: "13px",
};

export interface StandardsPageProps {
  readonly fetcher?: typeof fetch;
  /** EPIC-039 GitHub integration flag; hides Save to GitHub when false. */
  readonly githubEnabled?: boolean;
  /** Tenant used by Run template now. */
  readonly tenantId?: string;
}

function toItem(template: StandardTemplate, assignedTo: string[] = []): StandardsTemplateItem {
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    assignedTo,
    standardsCount: template.settings.length,
    schedule: template.scheduleId,
    lastRunAt: null,
    autoRemediate: template.autoRemediate,
  };
}

export default function StandardsPage({
  fetcher,
  githubEnabled = false,
  tenantId = "",
}: StandardsPageProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const [templates, setTemplates] = useState<StandardsTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchStandardTemplates({}, doFetch);
      setTemplates(items.map((template) => toItem(template)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [doFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCloneAndEdit = async (item: StandardsTemplateItem): Promise<void> => {
    try {
      const clone = await cloneStandardTemplate(item.id, { name: `${item.name} (copy)` }, doFetch);
      await load();
      window.location.href = `/standards/${clone.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDriftClone = async (item: StandardsTemplateItem): Promise<void> => {
    try {
      const source = await (await doFetch(`/v1/standards/templates/${item.id}`)).json() as {
        template: StandardTemplate;
      };
      await createDriftClone(source.template, doFetch);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConvert = async (item: StandardsTemplateItem): Promise<void> => {
    const target: StandardTemplateKind = item.kind === "standards" ? "drift" : "standards";
    try {
      await convertStandardTemplate(item.id, target, doFetch);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunNow = async (item: StandardsTemplateItem): Promise<void> => {
    if (!tenantId.trim()) {
      setNotice("Enter a tenant id before running a template.");
      return;
    }
    try {
      await runStandardTemplateNow(item.id, tenantId.trim(), doFetch);
      setNotice(`Enqueued “${item.name}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetSchedule = async (item: StandardsTemplateItem): Promise<void> => {
    try {
      await setStandardTemplateSchedule(item.id, item.schedule ? null : "schedule-enabled", doFetch);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (item: StandardsTemplateItem): Promise<void> => {
    try {
      await deleteStandardTemplate(item.id, doFetch);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={pageStyle} data-testid="standards-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Standards Templates</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Desired-state templates applied per tenant through the remediation and scheduler
            contracts. Types: {kindLabel("standards")} / {kindLabel("drift")}.
          </p>
        </div>
      </div>

      {notice && <div style={noticeStyle} data-testid="standards-notice">{notice}</div>}

      <TemplatesTable
        templates={templates}
        loading={loading}
        error={error}
        githubEnabled={githubEnabled}
        onCreateTemplate={() => {
          window.location.href = "/standards/new";
        }}
        onViewTenantReport={() => {
          window.location.href = "/standards/alignment";
        }}
        onEdit={(item) => {
          window.location.href = `/standards/${item.id}`;
        }}
        onCloneAndEdit={handleCloneAndEdit}
        onCreateDriftClone={handleDriftClone}
        onRunTemplateNow={handleRunNow}
        onSetSchedule={handleSetSchedule}
        onDelete={handleDelete}
        onConvert={handleConvert}
        onSaveToGitHub={() => setNotice("Save to GitHub is provided by EPIC-039.")}
      />
    </div>
  );
}
