-- 0076_group_templates.sql — EPIC-014 Group templates persistence (SPEC §3.2, §5; T-0265).
-- Forward-only migration. Idempotent.

CREATE TABLE IF NOT EXISTS group_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  groupType    TEXT NOT NULL,
  naming       TEXT NOT NULL DEFAULT '{}',
  owners       TEXT NOT NULL DEFAULT '[]',
  members      TEXT NOT NULL DEFAULT '[]',
  settings     TEXT NOT NULL DEFAULT '{}',
  licensing    TEXT NOT NULL DEFAULT '[]',
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL,
  deletedAt    TEXT
);

CREATE INDEX IF NOT EXISTS idx_group_templates_deletedAt ON group_templates (deletedAt);
