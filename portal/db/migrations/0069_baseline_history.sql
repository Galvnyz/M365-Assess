-- 0069_baseline_history.sql — EPIC-010 rollout state, history, and trend (SPEC §4.5, §5).
-- Forward-only. Every statement is idempotent so the file can be re-applied; the
-- migration runner also skips already-applied versions.
--
-- baseline_rollouts holds the per-tenant stage state upserted by every T-0185
-- evaluation (the table ships here because T-0185 carries no migration of its
-- own). baseline_history is append-only: rows are never mutated or deleted
-- except by retention pruning inside the configured window (§9, 03-database.md
-- §7). baseline_trend carries one compliance point per evaluation for the
-- fleet chart (per-run sampling per §11.5).
--
-- Numbering: recorded as 0014_baseline_history.sql in the ticket (which also
-- names 0012 in its Report body), renumbered to 0069 (the next version after
-- T-0181's 0068) per the append-at-head convention; the ticket predates later
-- migrations. See 0067_drift_templates.sql for the renumber precedent.

CREATE TABLE IF NOT EXISTS baseline_rollouts (
  baselineId TEXT NOT NULL REFERENCES baselines (id) ON DELETE CASCADE,
  tenantId   TEXT NOT NULL,
  stage      INTEGER NOT NULL DEFAULT 0 CHECK (stage >= 0),
  state      TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'eligible', 'complete')),
  lastRunAt  TEXT NOT NULL,
  PRIMARY KEY (baselineId, tenantId)
);
CREATE INDEX IF NOT EXISTS idx_baseline_rollouts_tenant
  ON baseline_rollouts (tenantId);

CREATE TABLE IF NOT EXISTS baseline_history (
  id         TEXT PRIMARY KEY,
  baselineId TEXT NOT NULL REFERENCES baselines (id) ON DELETE CASCADE,
  tenantId   TEXT NOT NULL,
  event      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_baseline_history_baseline_tenant_at
  ON baseline_history (baselineId, tenantId, at);

CREATE TABLE IF NOT EXISTS baseline_trend (
  baselineId TEXT NOT NULL REFERENCES baselines (id) ON DELETE CASCADE,
  tenantId   TEXT NOT NULL,
  at         TEXT NOT NULL,
  compliance REAL NOT NULL CHECK (compliance >= 0 AND compliance <= 1),
  PRIMARY KEY (baselineId, tenantId, at)
);
CREATE INDEX IF NOT EXISTS idx_baseline_trend_baseline_at
  ON baseline_trend (baselineId, at);
