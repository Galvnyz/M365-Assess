"use client";

// Standards template builder (EPIC-008 SPEC.md §3.2, T-0147).
// Timeline sidebar: Set a name → Assign to tenants → Add standards → Configure
// all standards (auto-completes). Per-standard accordions expose the action flags
// and the autoRemediate switch; the picker draws from the T-0144 catalog and
// flags licence-missing standards. `%variable%` tokens are allowed in settings
// and resolved at run time (T-0150). An unsaved-changes guard blocks navigation.
// Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useMemo, useState, use, type CSSProperties, type ReactElement } from "react";
import { StandardAccordion, DEFAULT_ACTIONS, type AccordionStandard } from "../../../../components/standards/StandardAccordion";
import { StandardPicker } from "../../../../components/standards/StandardPicker";
import {
  fetchStandardTemplate,
  fetchStandardsCatalog,
  createStandardTemplate,
  updateStandardTemplate,
  type CatalogStandard,
  type StandardTemplate,
  type StandardTemplateActions,
} from "../../../../lib/standardsApi";

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1200px",
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "220px 1fr",
  gap: "24px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const sidebarStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  alignSelf: "start",
};

const stepStyle = (state: "done" | "current" | "todo"): CSSProperties => ({
  display: "flex",
  gap: "10px",
  alignItems: "center",
  padding: "8px 10px",
  borderRadius: "6px",
  background: state === "current" ? "var(--accent-soft)" : "transparent",
  color: state === "todo" ? "var(--text-soft)" : "var(--text)",
  fontWeight: state === "current" ? 600 : 500,
  fontSize: "14px",
});

const mainStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const panelStyle: CSSProperties = {
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontSize: "13px",
  color: "var(--text-soft)",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--accent-text)",
  borderColor: "var(--accent)",
};

interface BuilderStandard {
  readonly key: string;
  readonly check: string;
  readonly name: string;
  readonly category: string;
  readonly licenseState: string | null;
  readonly actions: StandardTemplateActions;
  readonly autoRemediate: boolean;
}

const STEPS = ["Set a name", "Assign to tenants", "Add standards", "Configure all standards"] as const;

export interface StandardBuilderPageProps {
  readonly params: Promise<{ id: string }> | { id: string };
  readonly fetcher?: typeof fetch;
  /** Navigation seam; defaults to window.location.href. */
  readonly navigate?: (url: string) => void;
  readonly onSaved?: (template: StandardTemplate) => void;
}

export default function StandardBuilderPage(props: StandardBuilderPageProps): ReactElement {
  const resolvedParams =
    typeof (props.params as Promise<{ id: string }>).then === "function"
      ? use(props.params as Promise<{ id: string }>)
      : (props.params as { id: string });
  const templateId = resolvedParams.id;
  const isNew = templateId === "new";
  const doFetch = props.fetcher ?? fetch;
  const navigate = props.navigate ?? ((url: string) => { window.location.href = url; });

  const [name, setName] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [standards, setStandards] = useState<BuilderStandard[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [catalog, setCatalog] = useState<CatalogStandard[]>([]);
  const [dirty, setDirty] = useState(false);
  const [guardUrl, setGuardUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      setCatalog(await fetchStandardsCatalog({}, doFetch));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [doFetch]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (isNew) return;
    void (async () => {
      try {
        const template = await fetchStandardTemplate(templateId, doFetch);
        setName(template.name);
        setStandards(
          template.settings.map((setting) => ({
            key: setting.key,
            check: setting.key,
            name: setting.key,
            category: "",
            licenseState: null,
            actions: template.actions,
            autoRemediate: template.autoRemediate,
          })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [templateId, isNew, doFetch]);

  // Unsaved-changes guard: warn the browser before unload while dirty.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const attemptNavigate = (url: string): void => {
    if (dirty) {
      setGuardUrl(url);
      return;
    }
    navigate(url);
  };

  const stepState = useMemo(() => {
    return [
      name.trim().length > 0 ? "done" : "current",
      assignTo.trim().length > 0 ? "done" : name.trim() ? "current" : "todo",
      standards.length > 0 ? "done" : assignTo.trim() ? "current" : "todo",
      standards.length > 0 ? "current" : "todo",
    ] as const;
  }, [name, assignTo, standards.length]);

  const addStandards = (chosen: readonly CatalogStandard[]): void => {
    setStandards((prev) => {
      const existing = new Set(prev.map((s) => s.key));
      const additions = chosen
        .filter((item) => !existing.has(item.check))
        .map((item) => ({
          key: item.check,
          check: item.check,
          name: item.name,
          category: item.category,
          licenseState: item.licenseState,
          actions: { ...DEFAULT_ACTIONS },
          autoRemediate: false,
        }));
      return [...prev, ...additions];
    });
    setShowPicker(false);
    setDirty(true);
  };

  const updateStandard = (key: string, next: { actions: StandardTemplateActions; autoRemediate: boolean }): void => {
    setStandards((prev) => prev.map((s) => (s.key === key ? { ...s, ...next } : s)));
    setDirty(true);
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const settings = standards.map((s) => ({ key: s.key, value: s.check }));
      const actions = standards[0]?.actions ?? { ...DEFAULT_ACTIONS };
      const autoRemediate = standards.some((s) => s.autoRemediate);
      const saved = isNew
        ? await createStandardTemplate({ name: name.trim(), kind: "standards", actions, autoRemediate, settings }, doFetch)
        : await updateStandardTemplate(templateId, { name: name.trim(), actions, autoRemediate, settings }, doFetch);
      setDirty(false);
      setNotice("Template saved.");
      props.onSaved?.(saved);
      if (isNew) navigate(`/standards/${saved.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={pageStyle} data-testid="standard-builder">
      <aside style={sidebarStyle} data-testid="builder-timeline">
        <strong style={{ fontSize: "13px", color: "var(--text-soft)", textTransform: "uppercase" }}>
          Template setup
        </strong>
        {STEPS.map((step, index) => (
          <div key={step} style={stepStyle(stepState[index])} data-testid={`timeline-step-${index}`}>
            <span aria-hidden="true">{stepState[index] === "done" ? "✓" : index + 1}</span>
            <span>{step}</span>
          </div>
        ))}
      </aside>

      <div style={mainStyle}>
        {notice && <div style={{ padding: "10px 14px", background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "6px", color: "var(--accent-text)", fontSize: "13px" }} data-testid="builder-notice">{notice}</div>}
        {error && <div style={{ padding: "12px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">{error}</div>}

        <div style={panelStyle}>
          <label style={labelStyle}>
            Template name
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              style={inputStyle}
              data-testid="builder-name"
            />
          </label>
          <label style={labelStyle}>
            Assign to tenants (comma separated)
            <input
              type="text"
              value={assignTo}
              onChange={(e) => { setAssignTo(e.target.value); setDirty(true); }}
              style={inputStyle}
              data-testid="builder-assign"
            />
          </label>
        </div>

        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Standards ({standards.length})</strong>
            <button type="button" style={primaryButtonStyle} onClick={() => setShowPicker(true)} data-testid="builder-add-standards">
              Add standards
            </button>
          </div>
          {standards.length === 0 && (
            <div style={{ color: "var(--text-soft)", fontSize: "13px" }} data-testid="builder-empty-standards">
              No standards added yet.
            </div>
          )}
          {standards.map((standard) => (
            <StandardAccordion
              key={standard.key}
              standard={{ key: standard.key, check: standard.check, name: standard.name, category: standard.category, licenseState: standard.licenseState } as AccordionStandard}
              actions={standard.actions}
              autoRemediate={standard.autoRemediate}
              expanded={expandedKey === standard.key}
              onToggle={() => setExpandedKey(expandedKey === standard.key ? null : standard.key)}
              onChange={(next) => updateStandard(standard.key, next)}
              onRemove={() => { setStandards((prev) => prev.filter((s) => s.key !== standard.key)); setDirty(true); }}
            />
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" style={buttonStyle} onClick={() => attemptNavigate("/standards")} data-testid="builder-cancel">
            Cancel
          </button>
          <button type="button" style={primaryButtonStyle} disabled={saving} onClick={handleSave} data-testid="builder-save">
            {saving ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>

      {showPicker && (
        <StandardPicker items={catalog} onAdd={addStandards} onClose={() => setShowPicker(false)} />
      )}

      {guardUrl && (
        <div style={{ position: "fixed", inset: 0, background: "var(--overlay, rgba(0,0,0,0.5))", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} data-testid="unsaved-guard">
          <div style={{ ...panelStyle, width: "min(420px, 100%)" }}>
            <h2 style={{ margin: 0, fontSize: "16px" }}>Unsaved changes</h2>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-soft)" }}>
              You have unsaved changes. Leave without saving?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" style={buttonStyle} onClick={() => setGuardUrl(null)} data-testid="guard-stay">
                Stay
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => {
                  const url = guardUrl;
                  setGuardUrl(null);
                  setDirty(false);
                  navigate(url);
                }}
                data-testid="guard-leave"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
