"use client";

// Offboarding wizard (EPIC-011 SPEC.md §3.4, T-0210).
// Four steps: (1) tenant selection with per-tenant offboarding defaults from
// templates, (2) multi-user selection as displayName (UPN), (3) option toggles
// plus mailbox access (full ± automap, send as, send on behalf), (4) a
// confirmation summary with live per-step progress and per-step re-run. The
// page also lists past jobs filtered by Running/Planned/Failed/Completed with
// a task-details drawer. Destructive options are gated behind an explicit
// confirmation checkbox. Strictly uses report theme tokens with zero colour
// literals.

import React, { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import {
  getOffboardingProgress,
  listUserTemplates,
  rerunOffboardingStep,
  startOffboarding,
  type MailboxAccess,
  type OffboardingJob,
  type OffboardingOptions,
  type OffboardingStep,
  type UserTemplate,
} from "../../lib/offboardingApi";
import { listTenantUsers, type TenantUser } from "../../lib/usersApi";

export interface OffboardingWizardApi {
  readonly listUsers: (tenantId: string) => Promise<readonly TenantUser[]>;
  readonly listTemplates: () => Promise<readonly UserTemplate[]>;
  readonly startJob: (
    tenantId: string,
    userIds: readonly string[],
    options: OffboardingOptions,
  ) => Promise<{ job: OffboardingJob; steps: readonly OffboardingStep[] }>;
  readonly getProgress: (
    tenantId: string,
    jobId: string,
  ) => Promise<{ job: OffboardingJob; steps: readonly OffboardingStep[] }>;
  readonly rerunStep: (jobId: string, order: number) => Promise<{ step: OffboardingStep }>;
}

const defaultApi: OffboardingWizardApi = {
  listUsers: (tenantId) => listTenantUsers(tenantId, { limit: 100 }).then((page) => page.items),
  listTemplates: () => listUserTemplates().then((body) => body.templates),
  startJob: (tenantId, userIds, options) => startOffboarding(tenantId, userIds, options),
  getProgress: (tenantId, jobId) => getOffboardingProgress(tenantId, jobId),
  rerunStep: (jobId, order) => rerunOffboardingStep(jobId, order),
};

export interface OffboardingWizardProps {
  readonly api?: OffboardingWizardApi;
  readonly initialTenantId?: string;
  readonly initialUserIds?: readonly string[];
  readonly pollIntervalMs?: number;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const cardStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  padding: "16px",
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
  color: "var(--on-accent)",
  borderColor: "var(--accent)",
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "12px",
};

const drawerStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: "min(420px, 100vw)",
  background: "var(--bg-elev)",
  borderLeft: "1px solid var(--border)",
  zIndex: 61,
  padding: "24px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const OPTION_TOGGLES: ReadonlyArray<{ key: "disableSignIn" | "removeLicenses" | "convertMailbox" | "removeGroups"; label: string }> = [
  { key: "disableSignIn", label: "Disable sign-in" },
  { key: "removeLicenses", label: "Remove licenses" },
  { key: "convertMailbox", label: "Convert to shared mailbox" },
  { key: "removeGroups", label: "Remove group memberships" },
];

type JobFilter = "all" | "running" | "planned" | "failed" | "completed";

export function OffboardingWizard({
  api = defaultApi,
  initialTenantId = "",
  initialUserIds = [],
  pollIntervalMs = 2500,
}: OffboardingWizardProps): ReactElement {
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [templates, setTemplates] = useState<readonly UserTemplate[]>([]);
  const [users, setUsers] = useState<readonly TenantUser[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set(initialUserIds));
  const [options, setOptions] = useState({ disableSignIn: true, removeLicenses: true, convertMailbox: false, removeGroups: false });
  const [mailboxMode, setMailboxMode] = useState<MailboxAccess["mode"]>("full");
  const [automap, setAutomap] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<OffboardingJob | null>(null);
  const [activeSteps, setActiveSteps] = useState<readonly OffboardingStep[]>([]);
  const [pastJobs, setPastJobs] = useState<readonly { job: OffboardingJob; steps: readonly OffboardingStep[] }[]>([]);
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listTemplates()
      .then((loaded) => {
        if (!cancelled) setTemplates(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  async function loadUsers(): Promise<void> {
    const tenant = tenantId.trim();
    if (!tenant) {
      setError("Select a tenant first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setUsers(await api.listUsers(tenant));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleUser(id: string): void {
    setSelectedUsers((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function mailboxAccess(): MailboxAccess {
    return { mode: mailboxMode, automap: mailboxMode === "full" ? automap : false };
  }

  async function refreshProgress(tenant: string, jobId: string): Promise<void> {
    try {
      const progress = await api.getProgress(tenant, jobId);
      setActiveJob(progress.job);
      setActiveSteps(progress.steps);
      setPastJobs((previous) =>
        previous.map((entry) => (entry.job.id === jobId ? progress : entry)),
      );
      if (progress.job.state === "completed" || progress.job.state === "failed") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubmit(): Promise<void> {
    const tenant = tenantId.trim();
    const userIds = [...selectedUsers];
    if (!tenant || userIds.length === 0) {
      setError("Select a tenant and at least one user.");
      return;
    }
    if (!confirmed) {
      setError("Confirm the offboarding actions before submitting.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const started = await api.startJob(tenant, userIds, { ...options, mailboxAccess: mailboxAccess() });
      setActiveJob(started.job);
      setActiveSteps(started.steps);
      setPastJobs((previous) => [started, ...previous]);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => void refreshProgress(tenant, started.job.id), pollIntervalMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRerun(order: number): Promise<void> {
    if (!activeJob) return;
    setError(null);
    try {
      const rerun = await api.rerunStep(activeJob.id, order);
      setActiveSteps((previous) => previous.map((step) => (step.order === order ? rerun.step : step)));
      await refreshProgress(activeJob.tenantId, activeJob.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const filteredJobs = pastJobs.filter((entry) => {
    if (jobFilter === "all") return true;
    if (jobFilter === "running") return entry.job.state === "running";
    return entry.job.state === jobFilter;
  });
  const detailJob = pastJobs.find((entry) => entry.job.id === detailJobId) ?? null;
  const selectedList = users.filter((user) => selectedUsers.has(user.id));

  return (
    <div style={containerStyle} data-testid="offboarding-wizard">
      <div style={cardStyle} data-testid="wizard-step-tenant">
        <h3 style={{ margin: 0 }}>1. Tenant selection</h3>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Tenant id..."
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            style={inputStyle}
            aria-label="Tenant id"
            data-testid="wizard-tenant-input"
          />
          <button type="button" style={buttonStyle} onClick={() => void loadUsers()} data-testid="wizard-load-users-button">
            Load users
          </button>
        </div>
        {templates.length > 0 && (
          <div style={{ fontSize: "13px", color: "var(--text-soft)" }} data-testid="wizard-templates-note">
            Per-tenant offboarding defaults available from {templates.length} template{templates.length === 1 ? "" : "s"}.
          </div>
        )}
      </div>

      <div style={cardStyle} data-testid="wizard-step-users">
        <h3 style={{ margin: 0 }}>2. User selection ({selectedUsers.size} selected)</h3>
        {users.length === 0 && <div style={{ color: "var(--text-soft)", fontSize: "14px" }}>Load users from the tenant first.</div>}
        {users.map((user) => (
          <label key={user.id} style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px" }}>
            <input
              type="checkbox"
              checked={selectedUsers.has(user.id)}
              onChange={() => toggleUser(user.id)}
              data-testid={`wizard-select-user-${user.id}`}
            />
            {user.displayName ?? user.userPrincipalName} ({user.userPrincipalName})
          </label>
        ))}
      </div>

      <div style={cardStyle} data-testid="wizard-step-options">
        <h3 style={{ margin: 0 }}>3. Options</h3>
        {OPTION_TOGGLES.map((toggle) => (
          <label key={toggle.key} style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px" }}>
            <input
              type="checkbox"
              checked={options[toggle.key]}
              onChange={(e) => setOptions((previous) => ({ ...previous, [toggle.key]: e.target.checked }))}
              data-testid={`wizard-option-${toggle.key}`}
            />
            {toggle.label}
          </label>
        ))}
        <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px", opacity: 0.5 }}>
          <input type="checkbox" disabled title="Delete arrives with the full step expansion" data-testid="wizard-option-deleteUser" />
          Delete user (later expansion)
        </label>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px", flexWrap: "wrap" }}>
          <span>Mailbox access:</span>
          {(["full", "send-as", "send-on-behalf"] as const).map((mode) => (
            <label key={mode} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              <input
                type="radio"
                name="mailbox-access"
                checked={mailboxMode === mode}
                onChange={() => setMailboxMode(mode)}
                data-testid={`wizard-mailbox-mode-${mode}`}
              />
              {mode}
            </label>
          ))}
          <label style={{ display: "flex", gap: "4px", alignItems: "center", opacity: mailboxMode === "full" ? 1 : 0.5 }}>
            <input
              type="checkbox"
              checked={automap}
              disabled={mailboxMode !== "full"}
              onChange={(e) => setAutomap(e.target.checked)}
              data-testid="wizard-mailbox-automap"
            />
            Automap
          </label>
        </div>
      </div>

      <div style={cardStyle} data-testid="wizard-step-confirm">
        <h3 style={{ margin: 0 }}>4. Confirmation</h3>
        <div style={summaryGridStyle}>
          <div>
            <strong>Tenant</strong>
            <div style={{ fontSize: "14px" }}>{tenantId || "—"}</div>
          </div>
          <div>
            <strong>Users ({selectedList.length})</strong>
            <div style={{ fontSize: "14px" }}>{selectedList.map((user) => user.userPrincipalName).join(", ") || "—"}</div>
          </div>
          <div>
            <strong>Mailbox access</strong>
            <div style={{ fontSize: "14px" }}>{mailboxMode}{mailboxMode === "full" && automap ? " + automap" : ""}</div>
          </div>
        </div>
        <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            data-testid="wizard-confirm-checkbox"
          />
          I confirm these offboarding actions (required, including any destructive steps)
        </label>
        {error && (
          <div
            style={{
              padding: "12px",
              borderRadius: "6px",
              background: "var(--danger-soft)",
              border: "1px solid var(--danger)",
              color: "var(--danger-text)",
              fontSize: "14px",
            }}
            role="alert"
          >
            {error}
          </div>
        )}
        <div>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={loading}
            onClick={() => void handleSubmit()}
            data-testid="wizard-submit-button"
          >
            Start offboarding
          </button>
        </div>
      </div>

      {activeJob && (
        <div style={cardStyle} data-testid="wizard-progress">
          <h3 style={{ margin: 0 }}>Live progress: {activeJob.id} ({activeJob.state})</h3>
          {activeSteps.map((step) => (
            <div key={step.order} style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "14px" }} data-testid={`wizard-step-${step.order}`}>
              <span>
                {step.order}. {step.action} — {step.state}
              </span>
              {step.error && <span style={{ color: "var(--danger-text)" }}>{step.error}</span>}
              {step.state === "failed" && (
                <button type="button" style={buttonStyle} onClick={() => void handleRerun(step.order)} data-testid={`wizard-rerun-${step.order}`}>
                  Re-run
                </button>
              )}
            </div>
          ))}
          <div>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => void refreshProgress(activeJob.tenantId, activeJob.id)}
              data-testid="wizard-refresh-button"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      <div style={cardStyle} data-testid="wizard-past-jobs">
        <h3 style={{ margin: 0 }}>Past jobs</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          {(["all", "running", "planned", "failed", "completed"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              style={filter === jobFilter ? primaryButtonStyle : buttonStyle}
              onClick={() => setJobFilter(filter)}
              data-testid={`wizard-filter-${filter}`}
            >
              {filter[0]?.toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        {filteredJobs.length === 0 && <div style={{ color: "var(--text-soft)", fontSize: "14px" }}>No jobs match this filter.</div>}
        {filteredJobs.map((entry) => (
          <div key={entry.job.id} style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "14px" }} data-testid={`wizard-job-${entry.job.id}`}>
            <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{entry.job.id}</span>
            <span>{entry.job.state}</span>
            <button type="button" style={buttonStyle} onClick={() => setDetailJobId(entry.job.id)} data-testid={`wizard-job-detail-${entry.job.id}`}>
              Details
            </button>
          </div>
        ))}
      </div>

      {detailJob && (
        <aside style={drawerStyle} role="dialog" aria-label={`Offboarding job ${detailJob.job.id}`} data-testid="wizard-job-drawer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Task details</h3>
            <button type="button" style={buttonStyle} onClick={() => setDetailJobId(null)} data-testid="wizard-drawer-close">
              Close
            </button>
          </div>
          <div style={{ fontSize: "14px" }}>Job {detailJob.job.id} — {detailJob.job.state}</div>
          {detailJob.steps.map((step) => (
            <div key={step.order} style={{ fontSize: "14px" }}>
              {step.order}. {step.action} — {step.state}
              {step.error ? ` (${step.error})` : ""}
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}
