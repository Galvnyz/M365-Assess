// EPIC-016/018 worker-backed providers (T-0820).
//
// Each provider turns a route's typed call into a feature-worker job (tenant id, the
// tenant's credential block for Connect-WorkerTenant, and the worker's own fields),
// runs the entrypoint, and returns the worker's JSON in the route's shape. Worker
// failures surface as 502s carrying the worker's first diagnostic line; the worker has
// already scrubbed secrets from it (T-0826).
import { AppError } from "../errors.js";
import { FeatureWorkerError } from "../jobs/feature-worker.js";
import type { IntuneTemplate } from "../repository/intune-templates.js";
import type { ReusableSettingTemplate } from "../repository/reusable-setting-templates.js";
import type { CredentialStoreRow } from "../routes/credentials.js";
import type { BitLockerKeysProvider, BitLockerKeysResult } from "../routes/device-bitlocker.js";
import type { LapsCredentialsProvider, LapsCredentialsResult } from "../routes/device-laps.js";
import type {
  AssignmentFilterProvider,
  FilterDeployPlan,
  FilterDeployResult,
  FilterWriteResult,
  GraphFilterInput,
  LiveAssignmentFilter,
} from "../routes/intune-assignment-filters.js";
import type { ComparePolicy, ComparePolicyProvider } from "../routes/intune-compare.js";
import type { IntuneCrudProvider, IntuneCrudResult, IntunePlan } from "../routes/intune-policies-crud.js";
import type { IntunePoliciesPage, IntunePoliciesProvider } from "../routes/intune-policies.js";
import type {
  LiveReusableSetting,
  ReusableSettingsProvider,
  ReusableSettingsSyncResult,
} from "../routes/intune-reusable-settings.js";
import type {
  IntuneDeployOptions,
  IntuneTargetPlan,
  IntuneTargetResult,
  IntuneTemplateDeployProvider,
} from "../routes/intune-templates-deploy.js";
import { credentialBlock, type WorkerRunner } from "./workers.js";

export const WORKER_FAILED = "worker.failed";

/** Runs entrypoints for one tenant, adding the credential block and mapping failures to 502. */
function tenantWorker(run: WorkerRunner, credentials: CredentialStoreRow) {
  return async function call<T>(entrypoint: string, tenantId: string, fields: Record<string, unknown>): Promise<T> {
    const job = { tenantId, credential: await credentialBlock(credentials, tenantId), ...fields };
    try {
      return await run<T>(entrypoint, job);
    } catch (error) {
      if (error instanceof FeatureWorkerError) {
        const detail = error.diagnostics.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim();
        throw new AppError(WORKER_FAILED, detail ? `${error.message}: ${detail}` : error.message, 502);
      }
      throw error;
    }
  };
}

/** Workers report unsupported kinds as { error, message, statusCode } rather than throwing. */
function raiseWorkerError(result: unknown): void {
  if (typeof result === "object" && result !== null && "error" in result && "statusCode" in result) {
    const r = result as { error: string; message?: string; statusCode: number };
    throw new AppError(r.error, r.message ?? r.error, r.statusCode);
  }
}

export interface IntuneProviders {
  readonly policies: IntunePoliciesProvider;
  readonly crud: IntuneCrudProvider;
  readonly deploy: IntuneTemplateDeployProvider;
  readonly reusableSettings: ReusableSettingsProvider;
  readonly assignmentFilters: AssignmentFilterProvider;
  readonly compare: ComparePolicyProvider;
  readonly bitlocker: BitLockerKeysProvider;
  readonly laps: LapsCredentialsProvider;
}

export function createIntuneProviders(run: WorkerRunner, credentials: CredentialStoreRow): IntuneProviders {
  const call = tenantWorker(run, credentials);

  const crudJob = (kind: string, action: string, input: {
    displayName?: string;
    platform?: string;
    settings?: Record<string, unknown>;
    policyJson?: string;
    assignments?: readonly unknown[];
  }, preview: boolean) => ({
    kind,
    action,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.settings !== undefined ? { settingsJson: JSON.stringify(input.settings) } : {}),
    ...(input.policyJson !== undefined ? { policyJson: input.policyJson } : {}),
    ...(input.assignments !== undefined ? { assignmentsJson: JSON.stringify(input.assignments) } : {}),
    dryRun: preview,
  });

  const deployJob = (template: IntuneTemplate, options: IntuneDeployOptions, dryRun: boolean) => ({
    templateJson: JSON.stringify(template),
    ...(options.policyName ? { policyName: options.policyName } : {}),
    assignmentMode: options.assignmentMode,
    groups: options.groups,
    policyState: options.policyState,
    overwrite: options.overwrite,
    createGroups: options.createGroups,
    dryRun,
  });

  const filterJob = (action: string, fields: Record<string, unknown>) => ({ action, ...fields });

  return {
    policies: {
      async listPolicies(tenantId, kind, filter) {
        const result = await call<IntunePoliciesPage>("get-intune-policies.ps1", tenantId, {
          kind,
          ...(filter.platform ? { platform: filter.platform } : {}),
          ...(filter.policyType ? { policyType: filter.policyType } : {}),
          ...(filter.search ? { search: filter.search } : {}),
          ...(filter.modifiedDate ? { modifiedDate: filter.modifiedDate } : {}),
          ...(filter.assigned !== undefined ? { assigned: filter.assigned } : {}),
          top: filter.limit,
          ...(filter.cursor ? { skipToken: filter.cursor } : {}),
        });
        raiseWorkerError(result);
        return result;
      },
    },

    crud: {
      createPolicy: (tenantId, kind, input, preview) =>
        call<IntuneCrudResult | IntunePlan>("set-intune-policy.ps1", tenantId, crudJob(kind, "create", input, preview)),
      editPolicy: (tenantId, kind, policyId, input, preview) =>
        call<IntuneCrudResult | IntunePlan>("set-intune-policy.ps1", tenantId, {
          ...crudJob(kind, "edit", input, preview),
          policyId,
        }),
      deletePolicy: (tenantId, kind, policyId, confirmName, preview) =>
        call<IntuneCrudResult | IntunePlan>("set-intune-policy.ps1", tenantId, {
          kind,
          action: "delete",
          policyId,
          confirmName,
          dryRun: preview,
        }),
    },

    deploy: {
      async planTarget(template, tenantId, options) {
        const result = await call<{ plan: IntuneTargetPlan }>(
          "deploy-intune-template.ps1",
          tenantId,
          deployJob(template, options, true),
        );
        return result.plan;
      },
      deployTarget: (template, tenantId, options, createdBy) =>
        call<IntuneTargetResult>("deploy-intune-template.ps1", tenantId, {
          ...deployJob(template, options, false),
          actor: createdBy,
        }),
    },

    reusableSettings: {
      async listSettings(tenantId) {
        const result = await call<{ items: LiveReusableSetting[] }>("sync-reusable-settings.ps1", tenantId, {
          action: "list",
        });
        return result.items ?? [];
      },
      sync: (tenantId, templates: readonly ReusableSettingTemplate[], options) =>
        call<ReusableSettingsSyncResult>("sync-reusable-settings.ps1", tenantId, {
          action: "sync",
          templatesJson: JSON.stringify(templates),
          dryRun: options.preview,
          actor: options.actor,
        }),
    },

    assignmentFilters: {
      async list(tenantId) {
        const result = await call<{ items: LiveAssignmentFilter[] }>(
          "set-assignment-filter.ps1",
          tenantId,
          filterJob("list", {}),
        );
        return result.items ?? [];
      },
      create: (tenantId, input: GraphFilterInput, actor) =>
        call<FilterWriteResult>("set-assignment-filter.ps1", tenantId, filterJob("create", { filterJson: JSON.stringify(input), actor })),
      update: (tenantId, filterId, input, actor) =>
        call<FilterWriteResult>("set-assignment-filter.ps1", tenantId, filterJob("edit", { filterId, filterJson: JSON.stringify(input), actor })),
      remove: (tenantId, filterId, confirmName, actor) =>
        call<FilterWriteResult>("set-assignment-filter.ps1", tenantId, filterJob("delete", { filterId, confirmName, actor })),
      planDeploy: (tenantId, input) =>
        call<FilterDeployPlan>("set-assignment-filter.ps1", tenantId, filterJob("plan", { filterJson: JSON.stringify(input) })),
      deploy: (tenantId, input, actor) =>
        call<FilterDeployResult>("set-assignment-filter.ps1", tenantId, filterJob("deploy", { filterJson: JSON.stringify(input), actor })),
    },

    compare: {
      async getPolicy(tenantId, kind, policyId) {
        const detail = await call<ComparePolicy | null>("get-intune-policies.ps1", tenantId, { kind, policyId });
        return detail ?? undefined;
      },
    },

    bitlocker: {
      getKeys: (tenantId, deviceId) => call<BitLockerKeysResult>("get-bitlocker-keys.ps1", tenantId, { deviceId }),
    },

    laps: {
      getCredentials: (tenantId, deviceId) =>
        call<LapsCredentialsResult | null>("get-laps-credentials.ps1", tenantId, { deviceId }),
    },
  };
}
