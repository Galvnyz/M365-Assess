-- 0072_pim_settings_templates.sql — EPIC-013 PIM role settings templates (SPEC §3.2, §5; T-0243).
-- Forward-only migration after 0071. Idempotent.

CREATE TABLE IF NOT EXISTS pim_settings_templates (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  roleId              TEXT,
  settings            TEXT NOT NULL DEFAULT '{}',
  scope               TEXT NOT NULL DEFAULT '/',
  createdAt           TEXT NOT NULL,
  updatedAt           TEXT NOT NULL,
  deletedAt           TEXT
);
CREATE INDEX IF NOT EXISTS idx_pim_settings_templates_deletedAt ON pim_settings_templates (deletedAt);
CREATE INDEX IF NOT EXISTS idx_pim_settings_templates_roleId ON pim_settings_templates (roleId);
