-- 0066_standards_dedupe.sql — EPIC-008 standards dedupe + change-detection cache
-- (SPEC §4.3, §11.3). Forward-only. Every statement is idempotent so the file can
-- be re-applied; the migration runner also skips already-applied versions.
--
-- standards_dedupe: one row per (tenant, 12 h window) the standards timer has
--   enqueued for. The timer skips a tenant already present for the current
--   window, preventing double-application (CIPP RerunCache analogue).
-- standards_config_fingerprints: the last-seen fingerprint of a tenant's
--   cacheable config (Intune / Conditional Access first, §11.3), used to skip
--   tenants whose config is unchanged.
--
-- Numbering: recorded as 0010_standards_dedupe.sql in the ticket, renumbered to
-- 0066 (the next version after T-0142's 0065) per the append-at-head convention;
-- the ticket predates later migrations.

CREATE TABLE IF NOT EXISTS standards_dedupe (
  tenantId    TEXT NOT NULL,
  windowStart TEXT NOT NULL,
  enqueuedAt  TEXT NOT NULL,
  PRIMARY KEY (tenantId, windowStart)
);
CREATE INDEX IF NOT EXISTS idx_standards_dedupe_window ON standards_dedupe (windowStart);

CREATE TABLE IF NOT EXISTS standards_config_fingerprints (
  tenantId    TEXT NOT NULL,
  cacheKey    TEXT NOT NULL,
  configType  TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  updatedAt   TEXT NOT NULL,
  PRIMARY KEY (tenantId, cacheKey)
);
CREATE INDEX IF NOT EXISTS idx_standards_config_fingerprints_type
  ON standards_config_fingerprints (tenantId, configType);
