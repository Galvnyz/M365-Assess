// CA policy validation rules and guardrails (EPIC-015 SPEC.md §3.3, §4.3, §8, §11.1, §11.2; T-0282).
// Enforces lockout prevention, break-glass exclusion guardrails, and safe defaults.

export const GLOBAL_ADMIN_ROLE_ID = "62e90394-69f5-4237-9190-012177145e10";
export const PRIVILEGED_ROLE_ADMIN_ID = "e8611ab8-c189-46e8-94e1-60213ab1f814";
export const CONDITIONAL_ACCESS_ADMIN_ID = "b1be1c3e-b65d-4f19-8427-f6fa0d97feb9";

export const ERROR_ALL_USERS_BLOCK_NO_BREAKGLASS = "ca.guardrail.all_users_block_no_breakglass";
export const WARNING_ALL_USERS_NO_ADMIN_EXCLUSION = "ca.guardrail.all_users_no_admin_exclusion";
export const WARNING_SECURITY_DEFAULTS_CONFLICT = "ca.guardrail.security_defaults_conflict";

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
  readonly severity: "error" | "warning";
}

export interface CaPolicyUsersCondition {
  readonly includeUsers?: readonly string[];
  readonly excludeUsers?: readonly string[];
  readonly includeGroups?: readonly string[];
  readonly excludeGroups?: readonly string[];
  readonly includeRoles?: readonly string[];
  readonly excludeRoles?: readonly string[];
}

export interface CaPolicyGrantControlsInput {
  readonly operator?: string;
  readonly builtInControls?: readonly string[];
  readonly authenticationStrength?: unknown;
}

export interface CaPolicyConditionsInput {
  readonly users?: CaPolicyUsersCondition;
  readonly applications?: {
    readonly includeApplications?: readonly string[];
    readonly excludeApplications?: readonly string[];
  };
  readonly clientAppTypes?: readonly string[];
  readonly platforms?: Record<string, unknown>;
  readonly locations?: Record<string, unknown>;
  readonly signInRiskLevels?: readonly string[];
  readonly userRiskLevels?: readonly string[];
}

export interface CaPolicyPayload {
  readonly displayName?: string;
  readonly state?: "enabled" | "disabled" | "enabledForReportingButNotEnforced" | string;
  readonly conditions?: CaPolicyConditionsInput;
  readonly grantControls?: CaPolicyGrantControlsInput;
  readonly sessionControls?: Record<string, unknown>;
}

export interface CaPolicyValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly resolvedState: "enabled" | "disabled" | "enabledForReportingButNotEnforced" | string;
}

export function hasBreakGlassExclusion(users?: CaPolicyUsersCondition): boolean {
  if (!users) return false;
  const hasExcludeUsers = Array.isArray(users.excludeUsers) && users.excludeUsers.length > 0;
  const hasExcludeGroups = Array.isArray(users.excludeGroups) && users.excludeGroups.length > 0;
  const hasExcludeRoles = Array.isArray(users.excludeRoles) && users.excludeRoles.length > 0;
  return hasExcludeUsers || hasExcludeGroups || hasExcludeRoles;
}

export function hasAdminRoleExclusion(users?: CaPolicyUsersCondition): boolean {
  if (!users) return false;
  if (!Array.isArray(users.excludeRoles) || users.excludeRoles.length === 0) {
    return false;
  }
  return users.excludeRoles.includes(GLOBAL_ADMIN_ROLE_ID);
}

export function targetsAllUsers(users?: CaPolicyUsersCondition): boolean {
  if (!users || !Array.isArray(users.includeUsers)) {
    return false;
  }
  return users.includeUsers.includes("All");
}

export function isBlockControl(grantControls?: CaPolicyGrantControlsInput): boolean {
  if (!grantControls || !Array.isArray(grantControls.builtInControls)) {
    return false;
  }
  return grantControls.builtInControls.map((c) => c.toLowerCase()).includes("block");
}

export function validateCaPolicy(
  policy: CaPolicyPayload,
  options?: { isCreate?: boolean; securityDefaultsEnabled?: boolean },
): CaPolicyValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Display name validation
  if (options?.isCreate && (!policy.displayName || policy.displayName.trim().length === 0)) {
    issues.push({
      code: "ca.validation.missing_name",
      message: "Policy displayName is required",
      field: "displayName",
      severity: "error",
    });
  }

  // 2. Default state handling: new policies default to report-only unless explicitly requested
  let resolvedState = policy.state;
  if (options?.isCreate && (!resolvedState || resolvedState.trim().length === 0)) {
    resolvedState = "enabledForReportingButNotEnforced";
  } else if (!resolvedState) {
    resolvedState = "enabledForReportingButNotEnforced";
  }

  const users = policy.conditions?.users;
  const allUsers = targetsAllUsers(users);
  const block = isBlockControl(policy.grantControls);

  // 3. Hard-block: All users + Block without a break-glass exclusion (SPEC §11.2)
  if (allUsers && block && !hasBreakGlassExclusion(users)) {
    issues.push({
      code: ERROR_ALL_USERS_BLOCK_NO_BREAKGLASS,
      message: "Hard-block: cannot target 'All users' with 'Block' control without an explicit break-glass exclusion.",
      field: "conditions.users.excludeUsers",
      severity: "error",
    });
  }

  // 4. Warning: All users with no admin role exclusion (SPEC §4.3, §9)
  if (allUsers && !hasAdminRoleExclusion(users)) {
    issues.push({
      code: WARNING_ALL_USERS_NO_ADMIN_EXCLUSION,
      message: "Warning: Policy targets 'All users' with no admin exclusion; recommend excluding Global Administrator and emergency break-glass accounts.",
      field: "conditions.users.excludeRoles",
      severity: "warning",
    });
  }

  // 5. Warning: Security defaults conflict (SPEC §9)
  if (options?.securityDefaultsEnabled && resolvedState === "enabled") {
    issues.push({
      code: WARNING_SECURITY_DEFAULTS_CONFLICT,
      message: "Enabling Conditional Access policies conflicts with Security Defaults. Disable Security Defaults before enforcing.",
      field: "state",
      severity: "warning",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
    resolvedState,
  };
}
