-- 0079_tap_records.sql — EPIC-012 §5 TAPRecord (T-0223, moved here by T-0818).
-- Forward-only. Statements are idempotent so the file can be re-applied.
--
-- Only the non-secret record is stored; the pass value is returned once in the response
-- and never persisted. The same DDL still runs in openSqliteTapRecordRepository, so a
-- database opened that way before this migration keeps working.
CREATE TABLE IF NOT EXISTS tap_records (
  id              TEXT PRIMARY KEY,
  tenantId        TEXT NOT NULL,
  userId          TEXT NOT NULL,
  createdAt       TEXT NOT NULL,
  createdBy       TEXT,
  lifetimeMinutes INTEGER NOT NULL,
  oneTime         INTEGER NOT NULL,
  startTime       TEXT
);
CREATE INDEX IF NOT EXISTS idx_tap_records_tenant ON tap_records (tenantId, userId);
