-- 0080_report_templates.sql — EPIC-005 §5 report builder templates (moved here by T-0823).
-- Forward-only. Statements are idempotent so the file can be re-applied.
--
-- The same DDL still runs in openSqliteReportTemplateRepository, so a database opened
-- that way before this migration keeps working. `tenantId` is null for global templates.
CREATE TABLE IF NOT EXISTS report_templates (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  tenantId  TEXT,
  document  TEXT NOT NULL,
  createdBy TEXT,
  updatedBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_templates_tenantId ON report_templates (tenantId);
CREATE INDEX IF NOT EXISTS idx_report_templates_deletedAt ON report_templates (deletedAt);
