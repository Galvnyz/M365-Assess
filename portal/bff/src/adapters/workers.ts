// Worker-backed runners and the tenant credential block (T-0822).
//
// Feature workers sign in to their tenant from a `credential` block in the job file
// (T-0826): the credential reference plus the non-secret credential row. The BFF never
// handles secret material; the worker resolves it in its own process. `credentialBlock`
// is shared by every worker-backed provider (T-0818..T-0820).
import { AppError } from "../errors.js";
import {
  FeatureWorkerError,
  runFeatureWorker,
  type FeatureJob,
  type RunFeatureWorkerOptions,
} from "../jobs/feature-worker.js";
import type { CredentialRecord, CredentialStoreRow } from "../routes/credentials.js";
import type { GdapSyncResult, GdapSyncRunner } from "../routes/gdap.js";
import type { OnboardRunner, OnboardWorkerResult } from "../routes/onboard.js";
import type { TestConnectionResult, TestConnectionRunner } from "../routes/test-connection.js";

export const NO_CREDENTIAL = "tenant.credential_missing";
export const WORKER_FAILED = "worker.failed";

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

/** Calls entrypoints for one tenant's work with `(entrypoint, tenantId, fields)`. */
export type TenantWorkerCall = <T>(entrypoint: string, tenantId: string, fields: Record<string, unknown>) => Promise<T>;

/**
 * Runs entrypoints for one tenant, adding the tenant's credential block for
 * Connect-WorkerTenant (T-0826) and mapping a failed worker to a 502 carrying its first
 * diagnostic line; the worker has already scrubbed secrets from it.
 */
export function createTenantWorker(run: WorkerRunner, credentials: CredentialStoreRow): TenantWorkerCall {
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

/** Calls T-0007 envelope workers with `(entrypoint, tenantId, payload)`. */
export type EnvelopeWorkerCall = <T>(entrypoint: string, tenantId: string, payload: Record<string, unknown>) => Promise<T>;

/**
 * The EPIC-011..013 workers read the T-0007 envelope: `schemaVersion`, `tenantId`, a
 * `correlationId`, and their inputs under `payload`. The credential block stays at the
 * top level, where Connect-WorkerTenant reads it.
 */
export function createEnvelopeWorker(run: WorkerRunner, credentials: CredentialStoreRow): EnvelopeWorkerCall {
  const call = createTenantWorker(run, credentials);
  return <T>(entrypoint: string, tenantId: string, payload: Record<string, unknown>) =>
    call<T>(entrypoint, tenantId, { schemaVersion: "v1", correlationId: globalThis.crypto.randomUUID(), payload });
}

/**
 * Normalize a worker's list output. `$list | ConvertTo-Json` unrolls the pipeline, so a
 * one-item list arrives as a bare object and an empty one as no output at all.
 */
export function asArray<T>(value: T | readonly T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T];
}

/** Some workers report failures as `{ error, message, statusCode }` rather than throwing. */
export function raiseWorkerError(result: unknown): void {
  if (typeof result === "object" && result !== null && "error" in result && "statusCode" in result) {
    const r = result as { error: string; message?: string; statusCode: number };
    throw new AppError(r.error, r.message ?? r.error, r.statusCode);
  }
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
