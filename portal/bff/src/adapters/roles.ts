// EPIC-013 roles, PIM, and JIT (T-0818).
//
// The role, PIM, and JIT workers read flat job fields (createTenantWorker). The PIM
// request, PIM settings, and JIT routes persist through the @m365-assess/db
// repositories directly; these providers are the tenant side of each write.
import type { JitGrant, JitRepository } from "@m365-assess/db";
import type Database from "better-sqlite3";
import type { JitGrantExecutionProvider } from "../routes/jit-grants.js";
import type { ActiveGrantsResolver } from "../routes/jit-templates.js";
import type { PimAssignment, PimAssignmentsPage, PimAssignmentsProvider } from "../routes/pim.js";
import type { PimRequestSubmitProvider } from "../routes/pim-requests.js";
import type {
  LiveRoleSettingsProvider,
  PimSettingsApplyOutcome,
  PimSettingsApplyProvider,
} from "../routes/pim-settings-templates.js";
import type { RoleAssignment, RoleAssignmentsPage, RoleAssignmentsProvider } from "../routes/roles.js";
import { asArray, type TenantWorkerCall } from "./workers.js";

export interface RoleProviders {
  readonly roles: RoleAssignmentsProvider;
  readonly pim: PimAssignmentsProvider;
  readonly pimRequests: PimRequestSubmitProvider;
  readonly liveSettings: LiveRoleSettingsProvider;
  readonly applySettings: PimSettingsApplyProvider;
  readonly jit: JitGrantExecutionProvider;
}

const HOUR_MS = 3_600_000;

function listJob(filter: {
  role?: string;
  principalType?: string;
  assignmentType?: string;
  scope?: string;
  search?: string;
  cursor: string | null;
  limit: number;
}) {
  return {
    ...(filter.role ? { role: filter.role } : {}),
    ...(filter.principalType ? { principalType: filter.principalType } : {}),
    ...(filter.assignmentType ? { assignmentType: filter.assignmentType } : {}),
    ...(filter.scope ? { scope: filter.scope } : {}),
    ...(filter.search ? { search: filter.search } : {}),
    top: filter.limit,
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
  };
}

export function createRoleProviders(call: TenantWorkerCall): RoleProviders {
  return {
    roles: {
      async listRoleAssignments(tenantId, filter) {
        const page = await call<RoleAssignmentsPage>("get-role-assignments.ps1", tenantId, listJob(filter));
        return { ...page, items: asArray<RoleAssignment>(page.items) };
      },
    },

    pim: {
      async listPimAssignments(tenantId, filter) {
        const page = await call<PimAssignmentsPage>("get-pim-assignments.ps1", tenantId, listJob(filter));
        return { ...page, items: asArray<PimAssignment>(page.items) };
      },
    },

    pimRequests: {
      async submitRequest(tenantId, input) {
        const out = await call<{ id?: string; state: "pending" | "active"; startsAt?: string | null; endsAt?: string | null }>(
          "new-pim-request.ps1",
          tenantId,
          {
            principalId: input.principalId,
            roleId: input.roleId,
            action: input.action,
            justification: input.justification,
            durationHours: input.durationHours,
            approvalRequired: input.approvalRequired,
            ...(input.ticketNumber ? { ticketNumber: input.ticketNumber } : {}),
          },
        );
        return {
          ...(out.id ? { id: out.id } : {}),
          state: out.state,
          ...(out.startsAt ? { startsAt: out.startsAt } : {}),
          ...(out.endsAt ? { endsAt: out.endsAt } : {}),
        };
      },
    },

    liveSettings: {
      getLiveRoleSettings: (tenantId, roleId) => call("set-pim-role-settings.ps1", tenantId, { action: "get", roleId }),
    },

    applySettings: {
      async applySettings(tenantId, roleId, settings, options) {
        const out = await call<Partial<PimSettingsApplyOutcome>>("set-pim-role-settings.ps1", tenantId, {
          action: "apply",
          roleId,
          settings,
          dryRun: options.dryRun,
        });
        return {
          applied: out.applied ?? out.after ?? settings,
          ...(out.before ? { before: out.before } : {}),
          ...(out.after ? { after: out.after } : {}),
        };
      },
    },

    jit: {
      async grantRole(tenantId, grant) {
        const out = await call<{ id: string; startsAt: string; endsAt: string }>("new-jit-grant.ps1", tenantId, {
          action: "grant",
          userId: grant.userId,
          roleId: grant.roleId,
          assignmentType: grant.assignmentType,
          durationHours: grant.durationHours,
          maxDurationHours: grant.maxDurationHours,
          ...(grant.justification ? { justification: grant.justification } : {}),
        });
        return { grantId: out.id, startsAt: out.startsAt, endsAt: out.endsAt };
      },
      async revokeRole(tenantId, grant) {
        await call("new-jit-grant.ps1", tenantId, {
          action: "revoke",
          userId: grant.userId,
          roleId: grant.roleId,
          assignmentType: grant.assignmentType,
        });
      },
      // The route has already checked the new end against the grant's maximum; the
      // worker re-checks it and extends to exactly `newEndsAt`.
      async extendRole(tenantId, grant, newEndsAt) {
        const additionalHours = Math.round((Date.parse(newEndsAt) - Date.parse(grant.endsAt)) / HOUR_MS);
        await call("new-jit-grant.ps1", tenantId, {
          action: "extend",
          userId: grant.userId,
          roleId: grant.roleId,
          assignmentType: grant.assignmentType,
          durationHours: grant.durationHours,
          maxDurationHours: grant.maxDurationHours,
          additionalHours,
          newEndsAt,
        });
      },
    },
  };
}

/** Grants still in force for a template, across tenants (templates are global). */
export function createActiveGrantsResolver(db: Database.Database, repo: JitRepository): ActiveGrantsResolver {
  return {
    async getActiveGrantsForTemplate(templateId) {
      const rows = db
        .prepare("SELECT id FROM jit_grants WHERE templateId = ? AND state IN ('active', 'extended')")
        .all(templateId) as { id: string }[];
      const grants = await Promise.all(rows.map((row) => repo.getGrantById(row.id)));
      return grants.filter((grant): grant is JitGrant => grant !== undefined);
    },
  };
}
