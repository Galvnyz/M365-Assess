-- 0067_drift_templates.sql — EPIC-009 drift template binding (SPEC §5, §11.1).
-- Forward-only. Every statement is idempotent so the file can be re-applied; the
-- migration runner also skips already-applied versions.
--
-- A DriftTemplate is a StandardTemplate with kind='drift'; the template row (its
-- standards + settings) lives in standard_templates. This table holds only the
-- tenant binding, which is what enforces "at most one drift template per tenant"
-- (SPEC §11.1) and makes drift opt-in: a tenant with no row here has no drift
-- state (§9 "scope explosion" mitigation).
--
-- templateId is UNIQUE in both directions: a drift template belongs to exactly
-- one tenant. Seeding a second tenant clones the source into a new template
-- rather than sharing one row, so per-tenant desired state can diverge.
--
-- Numbering: recorded as 0011_drift_templates.sql in the ticket, renumbered to
-- 0067 (the next version after T-0149's 0066) per the append-at-head convention;
-- the ticket predates later migrations.

CREATE TABLE IF NOT EXISTS drift_templates (
  tenantId   TEXT PRIMARY KEY,
  templateId TEXT NOT NULL UNIQUE REFERENCES standard_templates (id),
  seededFrom TEXT,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drift_templates_template ON drift_templates (templateId);

-- Triaging a deviation is a tenant-scoped decision keyed stably by
-- tenantId + standardKey + resourceId (SPEC §11.4). The table is created here so
-- T-0162 can persist deviations; state/override columns are the triage surface.
CREATE TABLE IF NOT EXISTS drift_deviations (
  id                    TEXT PRIMARY KEY,
  tenantId              TEXT NOT NULL,
  standardKey           TEXT NOT NULL,
  resourceId            TEXT NOT NULL DEFAULT '',
  kind                  TEXT NOT NULL CHECK (kind IN ('mismatch', 'extra')),
  currentValue          TEXT,
  expectedValue         TEXT,
  state                 TEXT NOT NULL DEFAULT 'open'
                        CHECK (state IN ('open', 'accepted', 'customerSpecific', 'denied', 'deletePending', 'resolved')),
  reason                TEXT,
  expiresOn             TEXT,
  autoRemediateOnExpiry INTEGER NOT NULL DEFAULT 0 CHECK (autoRemediateOnExpiry IN (0, 1)),
  overrideValue         TEXT,
  lastSeenAt            TEXT NOT NULL,
  UNIQUE (tenantId, standardKey, resourceId)
);
CREATE INDEX IF NOT EXISTS idx_drift_deviations_tenant_state
  ON drift_deviations (tenantId, state);
