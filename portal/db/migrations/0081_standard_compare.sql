-- 0081_standard_compare.sql — EPIC-008 StandardCompare (SPEC §4.2, §5; T-0825).
-- Forward-only. Statements are idempotent so the file can be re-applied.
--
-- One row per tenant and standard: the current vs expected values the standard
-- execution worker records for its `report` action (the Set-CIPPStandardsCompareField
-- analogue), read by the alignment and compare views. A later run for the same
-- tenant and standard replaces the row. `currentValue` and `expectedValue` are JSON.
CREATE TABLE IF NOT EXISTS standard_compare (
  tenantId      TEXT NOT NULL,
  checkId       TEXT NOT NULL,
  currentValue  TEXT,
  expectedValue TEXT,
  state         TEXT NOT NULL CHECK (state IN (
                  'compliant', 'non-compliant', 'accepted deviation',
                  'customer specific', 'license missing', 'reporting disabled')),
  lastRunAt     TEXT,
  PRIMARY KEY (tenantId, checkId)
);
