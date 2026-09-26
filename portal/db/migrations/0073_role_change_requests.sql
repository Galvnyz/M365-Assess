-- 0073_role_change_requests.sql — EPIC-013 role change requests (SPEC §3.3, §4.3, §5, §11.1; T-0245).
-- Forward-only migration after 0072. Idempotent.

CREATE TABLE IF NOT EXISTS role_change_requests (
  id                  TEXT PRIMARY KEY,
  tenantId            TEXT NOT NULL,
  principalId         TEXT NOT NULL,
  roleId              TEXT NOT NULL,
  action              TEXT NOT NULL DEFAULT 'activate',
  state               TEXT NOT NULL DEFAULT 'pending',
  justification       TEXT NOT NULL,
  durationHours       INTEGER NOT NULL DEFAULT 8,
  ticketNumber        TEXT,
  approverId          TEXT,
  rejectionReason     TEXT,
  createdAt           TEXT NOT NULL,
  updatedAt           TEXT NOT NULL,
  startsAt            TEXT,
  endsAt              TEXT
);

CREATE INDEX IF NOT EXISTS idx_role_change_requests_tenantId ON role_change_requests (tenantId);
CREATE INDEX IF NOT EXISTS idx_role_change_requests_principalId ON role_change_requests (principalId);
CREATE INDEX IF NOT EXISTS idx_role_change_requests_state ON role_change_requests (state);
