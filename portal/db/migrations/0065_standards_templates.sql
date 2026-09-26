-- 0065_standards_templates.sql — EPIC-008 StandardTemplate and TemplateAssignment
-- (SPEC §5, §4.1). Forward-only. Every statement is idempotent so the file can be
-- re-applied; the migration runner also skips already-applied versions.
--
-- A StandardTemplate carries report/alert/remediate actions, an autoRemediate
-- flag, a keyed settings list (the three-tier merge is per setting key), a
-- `standards|drift` kind, and an optional scheduleId. assignments bind a template
-- to a target scope with a precedence used to break ties inside one tier. An
-- `allTenants` target carries an empty targetId so it can sit in the primary key
-- alongside the scoped rows.
--
-- Numbering: recorded as 0009_standards_templates.sql in the ticket, renumbered
-- to 0065 (the next version after T-0141's 0064) per the append-at-head
-- convention; the ticket predates later migrations.

CREATE TABLE IF NOT EXISTS standard_templates (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('standards', 'drift')),
  actions       TEXT NOT NULL DEFAULT '{"report":true,"alert":true,"remediate":false}',
  autoRemediate INTEGER NOT NULL DEFAULT 0 CHECK (autoRemediate IN (0, 1)),
  settings      TEXT NOT NULL DEFAULT '[]',
  scheduleId    TEXT,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_standard_templates_kind ON standard_templates (kind);

CREATE TABLE IF NOT EXISTS template_assignments (
  templateId TEXT NOT NULL REFERENCES standard_templates (id),
  targetType TEXT NOT NULL CHECK (targetType IN ('allTenants', 'group', 'tenant')),
  targetId   TEXT NOT NULL DEFAULT '',
  precedence INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (templateId, targetType, targetId)
);
CREATE INDEX IF NOT EXISTS idx_template_assignments_target
  ON template_assignments (targetType, targetId);
