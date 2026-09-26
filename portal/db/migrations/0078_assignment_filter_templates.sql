-- 0078_assignment_filter_templates.sql — EPIC-016 §5 AssignmentFilterTemplate set (T-0309).
-- Forward-only. Statements are idempotent so the file can be re-applied.
--
-- Live assignment filters are read from Graph; only templates persist. `platform` is a
-- T-0301 registry platform (windows/android/ios/macos) and `rule` a filter rule string,
-- both validated by the BFF before they reach here. `source` is 'local' in v1, as for
-- intune_templates.

CREATE TABLE IF NOT EXISTS assignment_filter_templates (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  platform  TEXT NOT NULL,
  rule      TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_assignment_filter_templates_deletedAt ON assignment_filter_templates (deletedAt);
