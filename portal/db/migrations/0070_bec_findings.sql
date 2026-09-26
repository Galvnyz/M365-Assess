-- 0070_bec_findings.sql — EPIC-011 BEC compromise findings (SPEC §5, §4.5).
-- Forward-only: the next numbered migration after 0069, so its number can never
-- change once applied. Every statement is idempotent so the file can be re-applied.

CREATE TABLE IF NOT EXISTS bec_findings (
  id        TEXT PRIMARY KEY,
  tenantId  TEXT NOT NULL REFERENCES tenants (id),
  userId    TEXT NOT NULL,
  "check"   TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT '{}',
  state     TEXT NOT NULL DEFAULT 'open'
            CHECK (state IN ('open', 'remediated', 'dismissed')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bec_findings_tenant_user ON bec_findings (tenantId, userId);
CREATE INDEX IF NOT EXISTS idx_bec_findings_state ON bec_findings (state);
