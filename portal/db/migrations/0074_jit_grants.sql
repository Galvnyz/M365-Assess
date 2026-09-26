-- 0074_jit_grants.sql — EPIC-013 JIT admin grants (SPEC §3.4, §4.4, §5, §11.2; T-0246).
-- Forward-only migration after 0073. Idempotent.

CREATE TABLE IF NOT EXISTS jit_grants (
  id                  TEXT PRIMARY KEY,
  tenantId            TEXT NOT NULL,
  userId              TEXT NOT NULL,
  roleId              TEXT NOT NULL,
  templateId          TEXT,
  assignmentType      TEXT NOT NULL DEFAULT 'eligible',
  startsAt            TEXT NOT NULL,
  endsAt              TEXT NOT NULL,
  durationHours       INTEGER NOT NULL DEFAULT 8,
  maxDurationHours    INTEGER NOT NULL DEFAULT 24,
  state               TEXT NOT NULL DEFAULT 'active',
  justification       TEXT,
  createdBy           TEXT NOT NULL,
  createdAt           TEXT NOT NULL,
  updatedAt           TEXT NOT NULL,
  revokedAt           TEXT,
  revokedBy           TEXT
);

CREATE INDEX IF NOT EXISTS idx_jit_grants_tenantId ON jit_grants (tenantId);
CREATE INDEX IF NOT EXISTS idx_jit_grants_userId ON jit_grants (userId);
CREATE INDEX IF NOT EXISTS idx_jit_grants_state ON jit_grants (state);
