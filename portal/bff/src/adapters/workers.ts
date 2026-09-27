// Worker-backed runners and the tenant credential block (T-0822).
//
// Feature workers sign in to their tenant from a `credential` block in the job file
// (T-0826): the credential reference plus the non-secret credential row. The BFF never
// handles secret material; the worker resolves it in its own process. `credentialBlock`
// is shared by every worker-backed provider (T-0818..T-0820).
import { AppError } from "../errors.js";
import { runFeatureWorker, type FeatureJob, type RunFeatureWorkerOptions } from "../jobs/feature-worker.js";
import type { CredentialRecord, CredentialStoreRow } from "../routes/credentials.js";
import type { GdapSyncResult, GdapSyncRunner } from "../routes/gdap.js";
import type { OnboardRunner, OnboardWorkerResult } from "../routes/onboard.js";
import type { TestConnectionResult, TestConnectionRunner } from "../routes/test-connection.js";

export const NO_CREDENTIAL = "tenant.credential_missing";

export interface CredentialBlock {
  readonly credentialRef: string;
  /** The non-secret credential row fields Resolve-TenantCredential reads. */
  readonly record: Pick<
    CredentialRecord,
    "tenantId" | "authMethod" | "clientId" | "secretRef" | "thumbprint" | "environment"
  >;
}

export function toCredentialBlock(credential: CredentialRecord): CredentialBlock {
  return {
    credentialRef: `tenants/${credential.tenantId}/credential`,
    record: {
      tenantId: credential.tenantId,
      authMethod: credential.authMethod,
      clientId: credential.clientId,
      secretRef: credential.secretRef,
      thumbprint: credential.thumbprint,
      environment: credential.environment,
    },
  };
}

/** The credential block for `tenantId`, or a 409 when the tenant has no credential yet. */
export async function credentialBlock(credentials: CredentialStoreRow, tenantId: string): Promise<CredentialBlock> {
  const row = await credentials.getCredential(tenantId);
  if (!row) {
    throw new AppError(NO_CREDENTIAL, `tenant '${tenantId}' has no credential; set one before running tenant work`, 409);
  }
  return toCredentialBlock(row);
}

/** Runs a worker entrypoint; injectable so providers are testable without pwsh. */
export type WorkerRunner = <T>(entrypoint: string, job: FeatureJob) => Promise<T>;

export function createWorkerRunner(options: RunFeatureWorkerOptions): WorkerRunner {
  return (entrypoint, job) => runFeatureWorker(entrypoint, job, options);
}

export function createTestConnectionRunner(run: WorkerRunner): TestConnectionRunner {
  return async (tenantId, credential) => {
    if (!credential) {
      return {
        tenantId,
        success: false,
        testedAt: new Date().toISOString(),
        services: [{ service: "Graph", status: "fail", connected: false, error: "tenant has no credential" }],
      };
    }
    return run<TestConnectionResult>("test-tenant-connection.ps1", {
      tenantId,
      credential: toCredentialBlock(credential),
    });
  };
}

export function createOnboardRunner(run: WorkerRunner): OnboardRunner {
  return (tenantId, input) =>
    run<OnboardWorkerResult>("onboard-tenant.ps1", {
      tenantId,
      confirmed: input.confirmed === true,
      createNew: input.createNew === true,
      ...(input.adminUpn ? { adminUpn: input.adminUpn } : {}),
      ...(input.appDisplayName ? { appDisplayName: input.appDisplayName } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.certificateThumbprint ? { certificateThumbprint: input.certificateThumbprint } : {}),
    });
}

/** GDAP discovery runs as the partner (MSP) tenant, using that tenant's own credential. */
export function createGdapSyncRunner(
  run: WorkerRunner,
  credentials: CredentialStoreRow,
  partnerTenantId: string,
): GdapSyncRunner {
  return async () =>
    run<GdapSyncResult>("sync-gdap-tenants.ps1", {
      tenantId: partnerTenantId,
      credential: await credentialBlock(credentials, partnerTenantId),
    });
}
