// EPIC-014 worker-backed group providers (T-0819).
//
// Each provider turns a route's typed call into a feature-worker job for the tenant
// (createTenantWorker adds the credential block and maps failures to 502s) and returns
// the worker's JSON in the route's shape. Audit events the workers return are recorded
// by the app, which knows the signed-in actor.
import { AppError } from "../errors.js";
import type { GroupTemplate } from "../repository/group-templates.js";
import type { GroupCrudProvider, GroupCrudResult, GroupPlan } from "../routes/groups-crud.js";
import type {
  GroupGalDeliveryPlan,
  GroupGalDeliveryProvider,
  GroupGalDeliveryResult,
} from "../routes/groups-gal.js";
import type { GroupsPage, GroupsProvider } from "../routes/groups-list.js";
import type { BulkMembershipPlan, BulkMembershipResult, GroupMembersProvider } from "../routes/groups-members.js";
import type { GroupUsageProvider, GroupUsageReport } from "../routes/groups-usage.js";
import type {
  DeployTemplateResult,
  GroupTemplateDeployProvider,
  GroupTemplateDeployment,
  TargetDeployPlan,
} from "../routes/group-templates-deploy.js";
import type { CredentialStoreRow } from "../routes/credentials.js";
import { createTenantWorker, raiseWorkerError, type WorkerRunner } from "./workers.js";

export interface GroupProviders {
  readonly list: GroupsProvider;
  readonly usage: GroupUsageProvider;
  readonly crud: GroupCrudProvider;
  readonly gal: GroupGalDeliveryProvider;
  readonly members: GroupMembersProvider;
  readonly templateDeploy: GroupTemplateDeployProvider;
}

/** What the group template deploy worker returns for a live (non-dry-run) deploy. */
interface GroupTemplateDeployOutput {
  readonly plan: TargetDeployPlan;
  readonly deployment: GroupTemplateDeployment;
  readonly auditEvent: Record<string, unknown>;
  readonly success: boolean;
}

export function createGroupProviders(run: WorkerRunner, credentials: CredentialStoreRow): GroupProviders {
  const call = createTenantWorker(run, credentials);

  const deployJob = (template: GroupTemplate, variables: Record<string, string> | undefined, dryRun: boolean) => ({
    template,
    variables: variables ?? {},
    dryRun,
  });

  // A template deploy runs the worker once per target tenant, one at a time so a large
  // deploy does not start a pwsh process per tenant at once. One tenant failing
  // (no credential, a blocked name conflict, a Graph error) is reported for that tenant
  // rather than failing the others.
  async function deployToTarget(
    template: GroupTemplate,
    tenantId: string,
    variables: Record<string, string> | undefined,
    createdBy: string,
  ): Promise<DeployTemplateResult> {
    try {
      const output = await call<GroupTemplateDeployOutput>("deploy-group-template.ps1", tenantId, {
        ...deployJob(template, variables, false),
        createdBy,
      });
      return {
        targetId: String(output.auditEvent["targetId"] ?? output.deployment.id),
        tenantId,
        deployment: output.deployment,
        auditEvent: output.auditEvent,
      };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const now = new Date().toISOString();
      return {
        targetId: template.id,
        tenantId,
        deployment: {
          id: globalThis.crypto.randomUUID(),
          templateId: template.id,
          tenantId,
          state: "failed",
          results: [{ step: "worker", status: "failed", error: error.message }],
          createdBy,
          createdAt: now,
          updatedAt: now,
        },
        auditEvent: {
          id: globalThis.crypto.randomUUID(),
          tenantId,
          action: "group-template.deploy",
          targetId: template.id,
          targetName: template.name,
          timestamp: now,
          result: "failure",
          error: error.message,
        },
      };
    }
  }

  return {
    list: {
      async listGroups(tenantId, filter) {
        const result = await call<GroupsPage>("get-groups.ps1", tenantId, {
          ...(filter.type ? { type: filter.type } : {}),
          ...(filter.hidden !== undefined ? { hidden: filter.hidden } : {}),
          ...(filter.dynamic !== undefined ? { dynamic: filter.dynamic } : {}),
          ...(filter.membershipSize ? { membershipSize: filter.membershipSize } : {}),
          ...(filter.search ? { search: filter.search } : {}),
          top: filter.limit,
          ...(filter.cursor ? { cursor: filter.cursor } : {}),
        });
        raiseWorkerError(result);
        return result;
      },
    },

    usage: {
      getUsage: (tenantId, inactiveDaysThreshold) =>
        call<GroupUsageReport>("get-group-usage.ps1", tenantId, { inactiveDaysThreshold }),
    },

    crud: {
      createGroup: (tenantId, input, preview) =>
        call<GroupCrudResult | GroupPlan>("set-group.ps1", tenantId, {
          action: "create",
          displayName: input.displayName,
          groupType: input.groupType,
          ...(input.mailNickname ? { mailNickname: input.mailNickname } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.dynamicRule ? { dynamicRule: input.dynamicRule } : {}),
          dryRun: preview,
        }),
      editGroup: (tenantId, groupId, input, preview) =>
        call<GroupCrudResult | GroupPlan>("set-group.ps1", tenantId, {
          action: "edit",
          groupId,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.dynamicRule !== undefined ? { dynamicRule: input.dynamicRule } : {}),
          dryRun: preview,
        }),
      deleteGroup: (tenantId, groupId, confirmName, preview) =>
        call<GroupCrudResult | GroupPlan>("set-group.ps1", tenantId, {
          action: "delete",
          groupId,
          confirmName,
          dryRun: preview,
        }),
    },

    gal: {
      setGal: (tenantId, groupId, input, preview) =>
        call<GroupGalDeliveryPlan | GroupGalDeliveryResult>("set-group-gal-delivery.ps1", tenantId, {
          groupId,
          target: "gal",
          hiddenFromAddressListsEnabled: input.hiddenFromAddressListsEnabled,
          dryRun: preview,
        }),
      setDelivery: (tenantId, groupId, input, preview) =>
        call<GroupGalDeliveryPlan | GroupGalDeliveryResult>("set-group-gal-delivery.ps1", tenantId, {
          groupId,
          target: "delivery",
          requireSenderAuthenticationEnabled: input.requireSenderAuthenticationEnabled,
          grantSendOnBehalfTo: input.grantSendOnBehalfTo ?? [],
          dryRun: preview,
        }),
    },

    members: {
      invokeBulkMembership: (tenantId, groupId, role, input, preview) =>
        call<BulkMembershipPlan | BulkMembershipResult>("group-membership-bulk.ps1", tenantId, {
          groupId,
          role,
          operation: input.operation,
          users: input.users,
          dryRun: preview,
        }),
    },

    templateDeploy: {
      async planDeploy(template, targets, variables) {
        const plans: TargetDeployPlan[] = [];
        for (const tenantId of targets) {
          try {
            plans.push(await call<TargetDeployPlan>("deploy-group-template.ps1", tenantId, deployJob(template, variables, true)));
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            plans.push({ tenantId, targetName: template.name, diff: [], valid: false, conflictError: error.message });
          }
        }
        return plans;
      },
      async executeDeploy(template, targets, variables, createdBy) {
        const results: DeployTemplateResult[] = [];
        for (const tenantId of targets) {
          results.push(await deployToTarget(template, tenantId, variables, createdBy ?? "system"));
        }
        return results;
      },
    },
  };
}
