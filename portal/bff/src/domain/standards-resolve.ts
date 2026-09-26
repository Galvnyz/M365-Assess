// Three-tier standards resolution (EPIC-008 SPEC.md §4.1, §5; T-0142).
//
// Applies AllTenants → Tenant Group → Tenant-specific assignments, where a later
// tier wins per setting (matching CIPP's Get-CIPPStandards). Within one tier the
// higher `precedence` wins; equal precedence falls back to templateId so the
// result is deterministic. A key a higher tier does not define falls through to
// the lower tier (a merge, not a replace).

// The StandardTemplate/TemplateAssignment shape mirrors the shared contract in
// portal/contracts/src/standards.ts; that module is not an exported subpath of
// @m365-assess/contracts and sits outside the BFF rootDir, so the shape (and the
// tier ranks) are restated here instead of importing across the boundary — the
// same pattern schedule-repository.ts uses for the schedules contract.

export const TEMPLATE_TARGET_TYPES = ["allTenants", "group", "tenant"] as const;
export type TemplateTargetType = (typeof TEMPLATE_TARGET_TYPES)[number];

export interface StandardTemplateSetting {
  readonly key: string;
  readonly value: unknown;
}

export interface StandardTemplate {
  readonly id: string;
  readonly name: string;
  readonly kind: "standards" | "drift";
  readonly actions: { readonly report: boolean; readonly alert: boolean; readonly remediate: boolean };
  readonly autoRemediate: boolean;
  readonly settings: readonly StandardTemplateSetting[];
  readonly scheduleId: string | null;
}

export interface TemplateAssignment {
  readonly templateId: string;
  readonly targetType: TemplateTargetType;
  readonly targetId: string | null;
  readonly precedence: number;
}

const TEMPLATE_TIER_RANK: Record<TemplateTargetType, number> = {
  allTenants: 0,
  group: 1,
  tenant: 2,
};

export interface StandardsResolutionInput {
  readonly tenantId: string;
  /** The tenant's group memberships (used for `group` assignments). */
  readonly groupIds?: readonly string[];
  readonly assignments: readonly TemplateAssignment[];
  readonly templates: readonly StandardTemplate[];
}

export interface ResolvedSettingSource {
  readonly templateId: string;
  readonly targetType: TemplateTargetType;
  readonly precedence: number;
}

export interface ResolvedSetting {
  readonly key: string;
  readonly value: unknown;
  readonly source: ResolvedSettingSource;
}

export interface StandardsResolution {
  readonly tenantId: string;
  /** Effective settings, ordered by key, each with the assignment that won. */
  readonly settings: readonly ResolvedSetting[];
  /** Contributing template ids, highest-priority tier first. */
  readonly appliedTemplateIds: readonly string[];
}

/** Ascending priority: low tier/precedence first, so the last write wins. */
function compareAssignments(left: TemplateAssignment, right: TemplateAssignment): number {
  const tier = TEMPLATE_TIER_RANK[left.targetType] - TEMPLATE_TIER_RANK[right.targetType];
  if (tier !== 0) return tier;
  if (left.precedence !== right.precedence) return left.precedence - right.precedence;
  return left.templateId.localeCompare(right.templateId);
}

function appliesToTenant(
  assignment: TemplateAssignment,
  tenantId: string,
  groups: ReadonlySet<string>,
): boolean {
  switch (assignment.targetType) {
    case "allTenants":
      return true;
    case "group":
      return assignment.targetId !== null && groups.has(assignment.targetId);
    case "tenant":
      return assignment.targetId === tenantId;
    default:
      return false;
  }
}

export function resolveStandards(input: StandardsResolutionInput): StandardsResolution {
  const templates = new Map<string, StandardTemplate>(
    input.templates.map((template) => [template.id, template]),
  );
  const groups = new Set(input.groupIds ?? []);

  const applicable = input.assignments
    .filter(
      (assignment) =>
        templates.has(assignment.templateId) &&
        appliesToTenant(assignment, input.tenantId, groups),
    )
    .sort(compareAssignments);

  const effective = new Map<string, ResolvedSetting>();
  for (const assignment of applicable) {
    const template = templates.get(assignment.templateId);
    if (!template) continue;
    for (const setting of template.settings) {
      effective.set(setting.key, {
        key: setting.key,
        value: setting.value,
        source: {
          templateId: template.id,
          targetType: assignment.targetType,
          precedence: assignment.precedence,
        },
      });
    }
  }

  const settings = [...effective.values()].sort((left, right) => left.key.localeCompare(right.key));

  const appliedTemplateIds: string[] = [];
  for (const assignment of [...applicable].reverse()) {
    if (!appliedTemplateIds.includes(assignment.templateId)) {
      appliedTemplateIds.push(assignment.templateId);
    }
  }

  return { tenantId: input.tenantId, settings, appliedTemplateIds };
}
