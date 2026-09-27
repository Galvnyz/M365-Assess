// EPIC-015 worker-backed Conditional Access providers (T-0819).
//
// Reads, writes, and template deploys run the CA workers for the tenant
// (createTenantWorker adds the credential block and maps failures to 502s). Audit
// events the workers return are recorded by the app, which knows the signed-in actor.
//
// Change history (SPEC §4.4) is meant to merge directory audits with the portal's own
// before/after records. No worker reads directory audits yet, so history is served
// from the portal's audit_events rows for CA policy writes and template deploys.
import type Database from "better-sqlite3";
import type { CaTemplate } from "../repository/ca-templates.js";
import type {
  CaCoverageProvider,
  CaCoverageResponse,
  CaHistoryResponse,
  CaPolicyChangeRecord,
} from "../routes/ca-coverage.js";
import type {
  CaNamedLocationMutationResult,
  CaNamedLocationPlan,
  CaNamedLocationsListResponse,
  CaNamedLocationsProvider,
} from "../routes/ca-named-locations.js";
import type { CaPoliciesPage, CaPoliciesProvider } from "../routes/ca-policies.js";
import type { CaCrudResult, CaPlan, CaPolicyCrudProvider } from "../routes/ca-policies-crud.js";
import type { CaReportOnlyProvider, CaReportOnlyResponse } from "../routes/ca-report-only.js";
import type {
  CaDeployDrawerOptions,
  CaDeployPlan,
  CaDeployResult,
  CaTemplateDeployProvider,
} from "../routes/ca-templates-deploy.js";
import type { CredentialStoreRow } from "../routes/credentials.js";
import type { CaPolicyPayload } from "../domain/ca-policy-validation.js";
import { createTenantWorker, raiseWorkerError, type WorkerRunner } from "./workers.js";

export interface CaProviders {
  readonly policies: CaPoliciesProvider;
  readonly crud: CaPolicyCrudProvider;
  readonly coverage: CaCoverageProvider;
  readonly reportOnly: CaReportOnlyProvider;
  readonly namedLocations: CaNamedLocationsProvider;
  readonly templateDeploy: CaTemplateDeployProvider;
}

/** audit_events actions that change a CA policy. */
const CA_HISTORY_ACTIONS = "action LIKE 'ca.policy.%' OR action = 'ca.template.deploy'";

interface AuditRow {
  readonly id: string;
  readonly timestamp: string;
  readonly actorUserId: string | null;
  readonly tenantId: string;
  readonly action: string;
  readonly targetId: string | null;
  readonly before: string | null;
  readonly after: string | null;
}

function parseObject(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function displayNameOf(record: Record<string, unknown> | null): string | undefined {
  const name = record?.["displayName"];
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/** Portal-recorded CA policy changes for a tenant, newest first. */
export function readCaHistory(db: Database.Database, tenantId: string, policyId?: string): CaHistoryResponse {
  const rows = db
    .prepare(
      `SELECT id, timestamp, actorUserId, tenantId, action, targetId, before, after
         FROM audit_events
        WHERE tenantId = ? AND (${CA_HISTORY_ACTIONS})${policyId ? " AND targetId = ?" : ""}
        ORDER BY timestamp DESC, rowid DESC`,
    )
    .all(...(policyId ? [tenantId, policyId] : [tenantId])) as AuditRow[];

  const items = rows.map((row): CaPolicyChangeRecord => {
    const before = parseObject(row.before);
    const after = parseObject(row.after);
    return {
      id: row.id,
      tenantId: row.tenantId,
      policyId: row.targetId ?? "",
      policyName: displayNameOf(after) ?? displayNameOf(before) ?? row.targetId ?? "",
      timestamp: row.timestamp,
      initiatedBy: row.actorUserId ?? "unknown",
      action: row.action,
      source: "portal",
      before,
      after,
    };
  });
  return { tenantId, ...(policyId ? { policyId } : {}), totalCount: items.length, items };
}

/** The CA policy worker takes the policy's parts as JSON strings. */
function caPolicyJob(input: CaPolicyPayload) {
  return {
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.conditions !== undefined ? { conditionsJson: JSON.stringify(input.conditions) } : {}),
    ...(input.grantControls !== undefined ? { grantControlsJson: JSON.stringify(input.grantControls) } : {}),
    ...(input.sessionControls !== undefined ? { sessionControlsJson: JSON.stringify(input.sessionControls) } : {}),
  };
}

export function createCaProviders(
  run: WorkerRunner,
  credentials: CredentialStoreRow,
  db: Database.Database,
): CaProviders {
  const call = createTenantWorker(run, credentials);

  const deployJob = (template: CaTemplate, options: CaDeployDrawerOptions, dryRun: boolean) => ({
    templateId: template.id,
    templateJson: JSON.stringify(template),
    ...(options.policyName ? { policyName: options.policyName } : {}),
    ...(options.policyState ? { policyState: options.policyState } : {}),
    ...(options.groupUserHandling ? { groupUserHandling: options.groupUserHandling } : {}),
    createGroups: options.createGroups ?? false,
    overwrite: options.overwrite ?? false,
    disableSecurityDefaults: options.disableSecurityDefaults ?? false,
    breakGlassExclusions: options.breakGlassExclusions ?? [],
    dryRun,
  });

  const locationFlags = (input: {
    isTrusted?: boolean;
    ipRanges?: readonly string[];
    countriesAndRegions?: readonly string[];
    includeUnknownCountriesAndRegions?: boolean;
    countryLookupMethod?: string;
  }) => ({
    ...(input.ipRanges !== undefined ? { ipRanges: input.ipRanges } : {}),
    ...(input.countriesAndRegions !== undefined ? { countriesAndRegions: input.countriesAndRegions } : {}),
    ...(input.isTrusted !== undefined ? { isTrusted: input.isTrusted } : {}),
    ...(input.includeUnknownCountriesAndRegions !== undefined
      ? { includeUnknownCountriesAndRegions: input.includeUnknownCountriesAndRegions }
      : {}),
    ...(input.countryLookupMethod ? { countryLookupMethod: input.countryLookupMethod } : {}),
  });

  type LocationResult = CaNamedLocationMutationResult | CaNamedLocationPlan;

  return {
    policies: {
      async listPolicies(tenantId, filter) {
        const result = await call<CaPoliciesPage>("get-ca-policies.ps1", tenantId, {
          ...(filter.state ? { state: filter.state } : {}),
          ...(filter.target ? { target: filter.target } : {}),
          ...(filter.control ? { control: filter.control } : {}),
          ...(filter.condition ? { condition: filter.condition } : {}),
          ...(filter.modifiedDate ? { modifiedDate: filter.modifiedDate } : {}),
          ...(filter.search ? { search: filter.search } : {}),
          top: filter.limit,
          ...(filter.cursor ? { cursor: filter.cursor } : {}),
        });
        raiseWorkerError(result);
        return result;
      },
    },

    crud: {
      createPolicy: (tenantId, input, preview) =>
        call<CaCrudResult | CaPlan>("set-ca-policy.ps1", tenantId, { action: "create", ...caPolicyJob(input), dryRun: preview }),
      editPolicy: (tenantId, policyId, input, preview) =>
        call<CaCrudResult | CaPlan>("set-ca-policy.ps1", tenantId, {
          action: "edit",
          policyId,
          ...caPolicyJob(input),
          dryRun: preview,
        }),
      deletePolicy: (tenantId, policyId, confirmName, preview) =>
        call<CaCrudResult | CaPlan>("set-ca-policy.ps1", tenantId, { action: "delete", policyId, confirmName, dryRun: preview }),
    },

    coverage: {
      getCoverage: (tenantId) => call<CaCoverageResponse>("get-ca-coverage.ps1", tenantId, {}),
      getHistory: async (tenantId, filter) => readCaHistory(db, tenantId, filter?.policyId),
    },

    reportOnly: {
      getReportOnlyEvaluation: (tenantId, filter) =>
        call<CaReportOnlyResponse>("get-ca-report-only.ps1", tenantId, {
          ...(filter?.policyId ? { policyId: filter.policyId } : {}),
        }),
    },

    namedLocations: {
      listLocations: (tenantId) => call<CaNamedLocationsListResponse>("set-ca-named-location.ps1", tenantId, { action: "list" }),
      createLocation: (tenantId, input, preview) =>
        call<LocationResult>("set-ca-named-location.ps1", tenantId, {
          action: "create",
          displayName: input.displayName,
          locationType: input.locationType,
          ...locationFlags(input),
          dryRun: preview,
        }),
      editLocation: (tenantId, locationId, input, preview) =>
        call<LocationResult>("set-ca-named-location.ps1", tenantId, {
          action: "edit",
          locationId,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...locationFlags(input),
          dryRun: preview,
        }),
      deleteLocation: (tenantId, locationId, confirmName, preview) =>
        call<LocationResult>("set-ca-named-location.ps1", tenantId, {
          action: "delete",
          locationId,
          ...(confirmName ? { confirmName } : {}),
          dryRun: preview ?? false,
        }),
    },

    templateDeploy: {
      async planDeploy(template, options) {
        const result = await call<{ plan: CaDeployPlan }>("deploy-ca-template.ps1", options.tenantId, deployJob(template, options, true));
        return result.plan;
      },
      executeDeploy: (template, options) =>
        call<CaDeployResult>("deploy-ca-template.ps1", options.tenantId, deployJob(template, options, false)),
    },
  };
}
