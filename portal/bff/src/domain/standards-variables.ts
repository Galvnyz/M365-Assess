// Standard setting variable resolution (EPIC-008 SPEC.md §4.5, §9; T-0150).
//
// `%name%` tokens in a template's settings resolve from TenantVariable values at
// run time (global + tenant scopes). The low-level substitution — including the
// fail-loud rule for an unknown token — lives in variable-substitution.ts
// (EPIC-002 T-0027); this module applies it per standard so ONE unresolved
// variable fails that standard loudly and is recorded, without silently
// substituting an empty string or aborting the whole batch.
//
// Errors name only the missing token, never a value, so secrets cannot leak.

import {
  VariableSubstitutionError,
  extractVariableTokens,
  substituteVariables,
  type VariableScopes,
} from "./variable-substitution.js";

export const STANDARDS_UNRESOLVED_VARIABLE = "standards.unresolved_variable";

export interface StandardSetting {
  readonly key: string;
  readonly value: unknown;
}

export interface ResolvedStandardSetting {
  readonly key: string;
  readonly value: unknown;
}

export interface VariableResolutionFailure {
  readonly key: string;
  readonly token: string;
  readonly error: string;
}

export interface VariableResolutionResult {
  readonly resolved: readonly ResolvedStandardSetting[];
  readonly failed: readonly VariableResolutionFailure[];
}

/**
 * Substitutes tokens in a setting value. Strings are substituted; arrays and
 * plain objects are walked recursively; other scalars pass through. Throws
 * VariableSubstitutionError on an unknown token.
 */
export function substituteSettingValue(value: unknown, scopes: VariableScopes): unknown {
  if (typeof value === "string") {
    return substituteVariables(value, scopes);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteSettingValue(item, scopes));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      out[nestedKey] = substituteSettingValue(nestedValue, scopes);
    }
    return out;
  }
  return value;
}

export type SingleResolution =
  | { readonly ok: true; readonly value: ResolvedStandardSetting }
  | { readonly ok: false; readonly failure: VariableResolutionFailure };

/** Resolves one setting; returns a failure record instead of throwing. */
export function resolveStandardSetting(
  setting: StandardSetting,
  scopes: VariableScopes,
): SingleResolution {
  try {
    return { ok: true, value: { key: setting.key, value: substituteSettingValue(setting.value, scopes) } };
  } catch (error) {
    if (error instanceof VariableSubstitutionError) {
      return {
        ok: false,
        failure: { key: setting.key, token: error.token, error: error.message },
      };
    }
    throw error;
  }
}

/**
 * Resolves every setting, splitting clean resolutions from loud failures. A
 * failure on one setting never prevents the others from resolving.
 */
export function resolveStandardSettings(
  settings: readonly StandardSetting[],
  scopes: VariableScopes,
): VariableResolutionResult {
  const resolved: ResolvedStandardSetting[] = [];
  const failed: VariableResolutionFailure[] = [];
  for (const setting of settings) {
    const result = resolveStandardSetting(setting, scopes);
    if (result.ok) {
      resolved.push(result.value);
    } else {
      failed.push(result.failure);
    }
  }
  return { resolved, failed };
}

/** Tokens referenced by a template's settings, for pre-flight validation. */
export function collectTemplateTokens(settings: readonly StandardSetting[]): string[] {
  const seen = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const token of extractVariableTokens(value)) seen.add(token);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  for (const setting of settings) walk(setting.value);
  return [...seen];
}
