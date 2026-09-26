-- 0071_user_templates.sql — EPIC-011 user templates (SPEC §3.5, §5 US-7).
-- Forward-only: the next numbered migration after 0070, so its number can never
-- change once applied. Every statement is idempotent so the file can be re-applied.
--
-- A template seeds creation defaults (properties, licenses, groups) and carries
-- per-tenant offboarding defaults (mailbox access mode, toggles) consumed by the
-- create path (T-0202) and the offboarding plan builder (T-0205). A template
-- never writes to a tenant on its own. Soft delete preserves history for audit.

CREATE TABLE IF NOT EXISTS user_templates (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  properties          TEXT NOT NULL DEFAULT '{}',
  licenses            TEXT NOT NULL DEFAULT '[]',
  groups              TEXT NOT NULL DEFAULT '[]',
  offboardingDefaults TEXT NOT NULL DEFAULT '{}',
  createdAt           TEXT NOT NULL,
  updatedAt           TEXT NOT NULL,
  deletedAt           TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_templates_deletedAt ON user_templates (deletedAt);
