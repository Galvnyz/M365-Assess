-- 0064_standard_definitions.sql — EPIC-008 StandardDefinition curated overrides
-- (SPEC §5, §11.4). Forward-only. Every statement is idempotent so the file can
-- be re-applied; the migration runner also skips already-applied versions.
--
-- Standard definitions themselves are derived from src/M365-Assess/controls/
-- registry.json at load and are NOT stored here. This table holds only the
-- optional curated override rows, keyed 1:1 by checkId, that win over the
-- registry value (SPEC §11.4). Keying by checkId is what lets a registry sync be
-- re-validated against the standards (§9 drift risk).
--
-- Numbering: the ticket recorded this file as 0008_standard_definitions.sql, but
-- the migration head when authored was already 0063, so the forward-only number
-- is 0064 (the next version after the head) — matching the append-at-head
-- convention all other migrations follow.

CREATE TABLE IF NOT EXISTS standard_definition_overrides (
  checkId       TEXT PRIMARY KEY,
  name          TEXT,
  category      TEXT,
  licensePreset TEXT CHECK (licensePreset IS NULL OR licensePreset IN ('E3', 'E5')),
  updatedAt     TEXT NOT NULL,
  updatedBy     TEXT
);
CREATE INDEX IF NOT EXISTS idx_standard_definition_overrides_category
  ON standard_definition_overrides (category);
