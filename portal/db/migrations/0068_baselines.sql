-- 0068_baselines.sql — EPIC-010 baselines data model (SPEC §5).
-- Forward-only. Every statement is idempotent so the file can be re-applied; the
-- migration runner also skips already-applied versions.
--
-- A Baseline rolls desired state out in ordered stages. Stages are stored as
-- rows (baselineId, stageOrder) so ordering is a query concern, not a JSON
-- blob: the repository enforces unique, contiguous zero-based ordering per
-- baseline (T-0181). Conditions are JSON (key + expected per staged standard,
-- `and`-only for v1 per §9); each condition is individually removable in the
-- builder (§3.3), so no separate conditions table is needed.
--
-- Assignments mirror the EPIC-008 three-tier vocabulary (allTenants/group/
-- tenant) so the T-0182 save gate (name + assignment + staged standard) can be
-- evaluated from storage; T-0182 carries no migration of its own.
--
-- Numbering: recorded as 0013_baselines.sql in the ticket (which also names
-- 0011 in its Report body), renumbered to 0068 (the next version after 0067)
-- per the append-at-head convention; the ticket predates later migrations.
-- See 0067_drift_templates.sql for the same renumber precedent.

CREATE TABLE IF NOT EXISTS baselines (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  logic     TEXT NOT NULL DEFAULT 'and' CHECK (logic IN ('and')),
  alerting  TEXT NOT NULL DEFAULT '{"enabled":false}',
  enabled   INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS baseline_stages (
  baselineId TEXT NOT NULL REFERENCES baselines (id) ON DELETE CASCADE,
  stageOrder INTEGER NOT NULL CHECK (stageOrder >= 0),
  conditions TEXT NOT NULL DEFAULT '[]',
  action     TEXT NOT NULL DEFAULT 'report' CHECK (action IN ('report', 'remediate')),
  PRIMARY KEY (baselineId, stageOrder)
);
CREATE INDEX IF NOT EXISTS idx_baseline_stages_baseline
  ON baseline_stages (baselineId, stageOrder);

CREATE TABLE IF NOT EXISTS baseline_assignments (
  baselineId TEXT NOT NULL REFERENCES baselines (id) ON DELETE CASCADE,
  targetType TEXT NOT NULL CHECK (targetType IN ('allTenants', 'group', 'tenant')),
  targetId   TEXT,
  precedence INTEGER NOT NULL DEFAULT 0,
  UNIQUE (baselineId, targetType, targetId)
);
CREATE INDEX IF NOT EXISTS idx_baseline_assignments_baseline
  ON baseline_assignments (baselineId);
