import { describe, expect, it } from "vitest";
import {
  ERROR_ALL_USERS_BLOCK_NO_BREAKGLASS,
  GLOBAL_ADMIN_ROLE_ID,
  WARNING_ALL_USERS_NO_ADMIN_EXCLUSION,
  WARNING_SECURITY_DEFAULTS_CONFLICT,
  validateCaPolicy,
} from "./ca-policy-validation.js";

describe("CA Policy Validation & Guardrails (T-0282)", () => {
  it("defaults new policy state to report-only (enabledForReportingButNotEnforced)", () => {
    const result = validateCaPolicy(
      {
        displayName: "New Test Policy",
      },
      { isCreate: true },
    );

    expect(result.valid).toBe(true);
    expect(result.resolvedState).toBe("enabledForReportingButNotEnforced");
  });

  it("preserves explicit state when provided on create", () => {
    const result = validateCaPolicy(
      {
        displayName: "Enforced Policy",
        state: "enabled",
      },
      { isCreate: true },
    );

    expect(result.resolvedState).toBe("enabled");
  });

  it("requires displayName on create", () => {
    const result = validateCaPolicy(
      {
        displayName: "",
      },
      { isCreate: true },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "displayName")).toBe(true);
  });

  it("hard-blocks 'All users' + 'Block' without break-glass exclusion", () => {
    const result = validateCaPolicy({
      displayName: "Block All Access",
      conditions: {
        users: {
          includeUsers: ["All"],
          excludeUsers: [],
          excludeGroups: [],
          excludeRoles: [],
        },
      },
      grantControls: {
        builtInControls: ["block"],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === ERROR_ALL_USERS_BLOCK_NO_BREAKGLASS)).toBe(true);
  });

  it("permits 'All users' + 'Block' when break-glass user is excluded", () => {
    const result = validateCaPolicy({
      displayName: "Block All Access with Break-glass",
      conditions: {
        users: {
          includeUsers: ["All"],
          excludeUsers: ["breakglass@example.com"],
          excludeRoles: [GLOBAL_ADMIN_ROLE_ID],
        },
      },
      grantControls: {
        builtInControls: ["block"],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("warns when 'All users' is targeted with no admin role exclusion", () => {
    const result = validateCaPolicy({
      displayName: "MFA for Everyone",
      conditions: {
        users: {
          includeUsers: ["All"],
          excludeRoles: [],
        },
      },
      grantControls: {
        builtInControls: ["mfa"],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === WARNING_ALL_USERS_NO_ADMIN_EXCLUSION)).toBe(true);
  });

  it("does not warn about admin exclusion when Global Administrator role is excluded", () => {
    const result = validateCaPolicy({
      displayName: "MFA for Everyone with Admin Exclude",
      conditions: {
        users: {
          includeUsers: ["All"],
          excludeRoles: [GLOBAL_ADMIN_ROLE_ID],
        },
      },
      grantControls: {
        builtInControls: ["mfa"],
      },
    });

    expect(result.warnings.some((w) => w.code === WARNING_ALL_USERS_NO_ADMIN_EXCLUSION)).toBe(false);
  });

  it("warns on conflict with security defaults when state is enabled", () => {
    const result = validateCaPolicy(
      {
        displayName: "Enforced MFA",
        state: "enabled",
      },
      { securityDefaultsEnabled: true },
    );

    expect(result.warnings.some((w) => w.code === WARNING_SECURITY_DEFAULTS_CONFLICT)).toBe(true);
  });
});
