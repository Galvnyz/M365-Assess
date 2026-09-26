-- 0077_reusable_setting_templates.sql — EPIC-016 §5 ReusableSettingTemplate set (T-0308).
-- Forward-only. Statements are idempotent so the file can be re-applied.
--
-- Live reusable settings are read from Graph; only templates persist. `settingsJson`
-- is a Graph deviceManagementReusablePolicySetting body (displayName + settingInstance);
-- the repository limits it to the v1 sync scope (SPEC §11.3) before it reaches here.

CREATE TABLE IF NOT EXISTS reusable_setting_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  settingsJson TEXT NOT NULL,
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL,
  deletedAt    TEXT
);
CREATE INDEX IF NOT EXISTS idx_reusable_setting_templates_deletedAt ON reusable_setting_templates (deletedAt);
