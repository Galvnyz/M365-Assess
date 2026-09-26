// Authentication-methods policy v1 presets (EPIC-012 SPEC.md §3.3, §11.2;
// T-0225). v1 ships common presets with the full per-method editor as a later
// expansion: each named preset maps to a concrete, validated policy shape the
// worker applies. Method ids reuse the T-0227 canonical vocabulary. This
// module is pure (no SDK or Graph call) so the mapping is unit-testable.
//
// Preset intent:
// - phishingResistantRequired: only §11.4 methods plus the bootstrap/survivor
//   kinds (Authenticator with number matching posture, TAP for onboarding new
//   PR methods, password which Graph never disables). SMS/voice (phone),
//   email OTP, and software OATH are disabled.
// - mfaRequired: every MFA-capable kind enabled; nothing that proves a second
//   factor is turned off.
// - standard: the balanced enterprise default — Authenticator, phone, OATH,
//   TAP, Hello for Business, passkey, and FIDO2 enabled; email OTP and the
//   PKI-gated certificate method disabled.

export const AUTH_METHOD_PRESET_IDS = [
  "phishingResistantRequired",
  "mfaRequired",
  "standard",
] as const;

export type AuthMethodPresetId = (typeof AUTH_METHOD_PRESET_IDS)[number];

export const AUTH_METHOD_POLICY_IDS = [
  "fido2",
  "passkey",
  "windowsHelloForBusiness",
  "certificateBasedAuthentication",
  "microsoftAuthenticator",
  "softwareOath",
  "temporaryAccessPass",
  "phone",
  "email",
  "password",
] as const;

export type AuthMethodPolicyId = (typeof AUTH_METHOD_POLICY_IDS)[number];

export type AuthMethodState = "enabled" | "disabled";

export interface AuthMethodConfig {
  readonly id: AuthMethodPolicyId;
  readonly state: AuthMethodState;
}

export interface AuthMethodPolicyShape {
  readonly methods: readonly AuthMethodConfig[];
}

export const AUTH_METHOD_PRESET_UNKNOWN = "authMethods.unknown_preset";
export const AUTH_METHOD_POLICY_INVALID = "authMethods.invalid_policy";

function config(id: AuthMethodPolicyId, state: AuthMethodState): AuthMethodConfig {
  return { id, state };
}

const PRESET_POLICIES: Readonly<Record<AuthMethodPresetId, AuthMethodPolicyShape>> = Object.freeze({
  phishingResistantRequired: Object.freeze({
    methods: Object.freeze([
      config("fido2", "enabled"),
      config("passkey", "enabled"),
      config("windowsHelloForBusiness", "enabled"),
      config("certificateBasedAuthentication", "enabled"),
      config("microsoftAuthenticator", "enabled"),
      config("softwareOath", "disabled"),
      config("temporaryAccessPass", "enabled"),
      config("phone", "disabled"),
      config("email", "disabled"),
      config("password", "enabled"),
    ]),
  }),
  mfaRequired: Object.freeze({
    methods: Object.freeze([
      config("fido2", "enabled"),
      config("passkey", "enabled"),
      config("windowsHelloForBusiness", "enabled"),
      config("certificateBasedAuthentication", "enabled"),
      config("microsoftAuthenticator", "enabled"),
      config("softwareOath", "enabled"),
      config("temporaryAccessPass", "enabled"),
      config("phone", "enabled"),
      config("email", "enabled"),
      config("password", "enabled"),
    ]),
  }),
  standard: Object.freeze({
    methods: Object.freeze([
      config("fido2", "enabled"),
      config("passkey", "enabled"),
      config("windowsHelloForBusiness", "enabled"),
      config("certificateBasedAuthentication", "disabled"),
      config("microsoftAuthenticator", "enabled"),
      config("softwareOath", "enabled"),
      config("temporaryAccessPass", "enabled"),
      config("phone", "enabled"),
      config("email", "disabled"),
      config("password", "enabled"),
    ]),
  }),
});

export function isAuthMethodPresetId(value: unknown): value is AuthMethodPresetId {
  return (
    typeof value === "string" &&
    (AUTH_METHOD_PRESET_IDS as readonly string[]).includes(value)
  );
}

export function parseAuthMethodPreset(value: unknown): AuthMethodPresetId {
  if (!isAuthMethodPresetId(value)) {
    throw new AuthMethodPresetError(
      AUTH_METHOD_PRESET_UNKNOWN,
      `unknown auth-methods preset '${typeof value === "string" ? value : typeof value}'; expected one of: ${AUTH_METHOD_PRESET_IDS.join(", ")}`,
    );
  }
  return value;
}

export class AuthMethodPresetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthMethodPresetError";
    this.code = code;
  }
}

// Maps a named preset to its concrete policy shape. The returned shape is a
// fresh copy so callers cannot mutate the frozen catalogue.
export function presetPolicy(preset: AuthMethodPresetId): AuthMethodPolicyShape {
  const shape = PRESET_POLICIES[preset];
  return { methods: shape.methods.map((entry) => ({ ...entry })) };
}

function isPolicyId(value: unknown): value is AuthMethodPolicyId {
  return (
    typeof value === "string" &&
    (AUTH_METHOD_POLICY_IDS as readonly string[]).includes(value)
  );
}

// Validates a caller-supplied concrete policy shape: every method id must be
// canonical, every state must be enabled/disabled, ids must be unique, and
// the shape must cover the full vocabulary so a partial write can never
// silently leave a method behind.
export function validatePolicyShape(value: unknown): AuthMethodPolicyShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuthMethodPresetError(AUTH_METHOD_POLICY_INVALID, "policy must be an object with a methods array");
  }
  const methods = (value as Record<string, unknown>)["methods"];
  if (!Array.isArray(methods)) {
    throw new AuthMethodPresetError(AUTH_METHOD_POLICY_INVALID, "policy.methods must be an array");
  }
  const seen = new Set<string>();
  const configs: AuthMethodConfig[] = methods.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new AuthMethodPresetError(AUTH_METHOD_POLICY_INVALID, `policy.methods[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    if (!isPolicyId(record["id"])) {
      throw new AuthMethodPresetError(
        AUTH_METHOD_POLICY_INVALID,
        `policy.methods[${index}].id must be one of: ${AUTH_METHOD_POLICY_IDS.join(", ")}`,
      );
    }
    if (record["state"] !== "enabled" && record["state"] !== "disabled") {
      throw new AuthMethodPresetError(
        AUTH_METHOD_POLICY_INVALID,
        `policy.methods[${index}].state must be 'enabled' or 'disabled'`,
      );
    }
    if (seen.has(record["id"])) {
      throw new AuthMethodPresetError(
        AUTH_METHOD_POLICY_INVALID,
        `policy.methods[${index}].id '${record["id"]}' is duplicated`,
      );
    }
    seen.add(record["id"]);
    return { id: record["id"], state: record["state"] };
  });
  const missing = AUTH_METHOD_POLICY_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new AuthMethodPresetError(
      AUTH_METHOD_POLICY_INVALID,
      `policy.methods is missing: ${missing.join(", ")}`,
    );
  }
  return { methods: configs };
}
