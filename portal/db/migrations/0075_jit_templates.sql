-- 0075_jit_templates.sql — EPIC-013 JIT admin templates (SPEC §3.4, §5; T-0247).
-- Forward-only migration after 0074. Idempotent.

CREATE TABLE IF NOT EXISTS jit_templates (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  description            TEXT,
  allowedRoles           TEXT NOT NULL DEFAULT '[]',
  duration               INTEGER NOT NULL DEFAULT 8,
  maxDuration            INTEGER NOT NULL DEFAULT 24,
  justificationRequired  INTEGER NOT NULL DEFAULT 1,
  approvalRequired       INTEGER NOT NULL DEFAULT 0,
  createdAt              TEXT NOT NULL,
  updatedAt              TEXT NOT NULL,
  deletedAt              TEXT
);

CREATE INDEX IF NOT EXISTS idx_jit_templates_deletedAt ON jit_templates (deletedAt);
