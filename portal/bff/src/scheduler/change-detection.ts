// Standards change-detection guard (EPIC-008 SPEC.md §4.3, §11.3; T-0149).
//
// CIPP's IntunePolicyTypeTracking analogue: a standard whose target config is
// unchanged since the last run is skipped, so a scheduled re-apply does not
// re-write identical settings and pollute the audit log (06-remediation §6).
//
// Resolved §11.3 makes Intune and Conditional Access the first cacheable config
// types; other types are always re-evaluated for now. The fingerprint store is
// injected so this module stays free of SQL.

import { createHash } from "node:crypto";

// ─── Errors ──────────────────────────────────────────────────────────────────

export const STANDARDS_UNSUPPORTED_CONFIG_TYPE = "standards.unsupported_config_type";

// ─── Cacheable config types (SPEC §11.3) ─────────────────────────────────────

export const CACHEABLE_CONFIG_TYPES = ["intune", "conditional-access"] as const;
export type CacheableConfigType = (typeof CACHEABLE_CONFIG_TYPES)[number];

export function isCacheableConfigType(value: string): value is CacheableConfigType {
  return (CACHEABLE_CONFIG_TYPES as readonly string[]).includes(value);
}

// ─── Fingerprint ─────────────────────────────────────────────────────────────

/** Stable serialization: object keys sorted so equal configs hash identically. */
export function stableStringify(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "null";
  if (depth > 16) return '"<max-depth>"';
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], depth + 1)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/** A content hash of a config value; equal configs produce equal fingerprints. */
export function computeConfigFingerprint(config: unknown): string {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

// ─── Store seam ──────────────────────────────────────────────────────────────

export interface CachedFingerprint {
  readonly configType: string;
  readonly fingerprint: string;
}

export interface ChangeDetectionStore {
  getFingerprint(tenantId: string, cacheKey: string): Promise<CachedFingerprint | undefined>;
  setFingerprint(
    tenantId: string,
    cacheKey: string,
    value: CachedFingerprint,
  ): Promise<void>;
}

export function createMemoryChangeDetectionStore(): ChangeDetectionStore {
  const store = new Map<string, CachedFingerprint>();
  const scope = (tenantId: string, key: string): string => `${tenantId}\n${key}`;
  return {
    async getFingerprint(tenantId, cacheKey) {
      return store.get(scope(tenantId, cacheKey));
    },
    async setFingerprint(tenantId, cacheKey, value) {
      store.set(scope(tenantId, cacheKey), value);
    },
  };
}

// ─── Detection ───────────────────────────────────────────────────────────────

export interface ConfigItem {
  /** Stable key for the config (e.g. the policy id). */
  readonly cacheKey: string;
  readonly configType: string;
  readonly config: unknown;
}

export interface DetectChangesInput {
  readonly tenantId: string;
  readonly items: readonly ConfigItem[];
}

export interface DetectChangesResult {
  /** Cacheable items whose config differs from the last run. */
  readonly changedKeys: readonly string[];
  /** Cacheable items whose config is unchanged. */
  readonly unchangedKeys: readonly string[];
  /** Non-cacheable items, always re-evaluated (never skipped). */
  readonly reEvaluatedKeys: readonly string[];
  /** True when every item is cacheable and unchanged, so a run is a no-op. */
  readonly allUnchanged: boolean;
}

/**
 * Compares each item's config against its stored fingerprint and records the
 * new fingerprint for cacheable items. A non-cacheable item is always
 * re-evaluated and never causes a skip on its own.
 */
export async function detectChanges(
  store: ChangeDetectionStore,
  input: DetectChangesInput,
): Promise<DetectChangesResult> {
  const changedKeys: string[] = [];
  const unchangedKeys: string[] = [];
  const reEvaluatedKeys: string[] = [];

  for (const item of input.items) {
    if (!isCacheableConfigType(item.configType)) {
      reEvaluatedKeys.push(item.cacheKey);
      continue;
    }
    const fingerprint = computeConfigFingerprint(item.config);
    const existing = await store.getFingerprint(input.tenantId, item.cacheKey);
    if (existing !== undefined && existing.fingerprint === fingerprint) {
      unchangedKeys.push(item.cacheKey);
      continue;
    }
    await store.setFingerprint(input.tenantId, item.cacheKey, {
      configType: item.configType,
      fingerprint,
    });
    changedKeys.push(item.cacheKey);
  }

  return {
    changedKeys,
    unchangedKeys,
    reEvaluatedKeys,
    allUnchanged:
      input.items.length > 0 && changedKeys.length === 0 && reEvaluatedKeys.length === 0,
  };
}
