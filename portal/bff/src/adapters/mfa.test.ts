import { SqliteTapRecordRepository, loadMigrations, runMigrations } from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { CredentialRecord, CredentialStoreRow } from "../routes/credentials.js";
import {
  createAuthMethodsPolicyProvider,
  createMfaProviders,
  createRegistrationCampaignProvider,
  createTapRecordStore,
} from "./mfa.js";
import { createEnvelopeWorker, createTenantWorker, type WorkerRunner } from "./workers.js";

const CRED: CredentialRecord = {
  id: "c",
  tenantId: "t-a",
  authMethod: "certificate-thumbprint",
  clientId: "app-1",
  secretRef: "thumbprint://ABC",
  thumbprint: "ABC",
  environment: "commercial",
  expiresOn: null,
  lastValidated: null,
  createdAt: "",
  updatedAt: "",
};

const credentials: CredentialStoreRow = {
  getCredential: async (tenantId) => (tenantId === "t-a" ? CRED : undefined),
  upsertCredential: async (input) => input,
  appendAuditEvent: async () => undefined,
};

type Job = Record<string, unknown> & { payload?: Record<string, unknown> };

function harness(respond: (entrypoint: string, job: Job) => unknown = () => ({})) {
  const calls: { entrypoint: string; job: Job }[] = [];
  const run: WorkerRunner = async (entrypoint, job) => {
    calls.push({ entrypoint, job: job as Job });
    return respond(entrypoint, job as Job) as never;
  };
  return { envelope: createEnvelopeWorker(run, credentials), flat: createTenantWorker(run, credentials), calls };
}

describe("MFA providers (T-0818)", () => {
  it("translates report filters into the worker's string values", async () => {
    const { envelope, calls } = harness(() => ({ rows: { userId: "u-1" }, nextCursor: null, retrievedAt: "2026-09-26T00:00:00Z" }));
    const page = await createMfaProviders(envelope).report.getMfaReport("t-a", {
      registered: "notRegistered",
      phishingResistant: false,
      adminRole: true,
      cursor: "100",
      limit: 50,
    });
    expect(calls[0]).toMatchObject({
      entrypoint: "get-mfa-report.ps1",
      job: {
        schemaVersion: "v1",
        payload: { registered: "notRegistered", phishingResistant: "not-phishing-resistant", adminRole: "true", top: 50, cursor: "100" },
      },
    });
    // A one-row page arrives unrolled; the provider restores the array.
    expect(page).toEqual({ rows: [{ userId: "u-1" }], nextCursor: null, retrievedAt: "2026-09-26T00:00:00Z" });
  });

  it("maps the TAP worker's temporaryAccessPass to the route's pass", async () => {
    const { envelope, calls } = harness(() => ({
      id: "tap-1",
      status: "applied",
      expiresAt: "2026-09-26T01:00:00Z",
      temporaryAccessPass: "Secret-Pass",
      error: null,
    }));
    const out = await createMfaProviders(envelope).tap.createTap("t-a", "u-1", { lifetimeMinutes: 60, oneTime: true, startTime: null, dryRun: false });
    expect(out).toEqual({ status: "applied", id: "tap-1", expiresAt: "2026-09-26T01:00:00Z", pass: "Secret-Pass", error: null });
    expect(calls[0]!.job.payload).toEqual({ userId: "u-1", lifetimeMinutes: 60, oneTime: true, dryRun: false, confirmed: true });
  });

  it("sends reset, push, and default-method jobs confirmed", async () => {
    const { envelope, calls } = harness(() => ({ status: "applied" }));
    const mfa = createMfaProviders(envelope);
    await mfa.reset.resetMfa("t-a", "u-1", { dryRun: false });
    await mfa.actions.sendPush("t-a", "u-1", { dryRun: false });
    await mfa.actions.setDefaultMethod("t-a", "u-1", "fido2", { dryRun: false });
    expect(calls.map((c) => [c.entrypoint, c.job.payload])).toEqual([
      ["reset-user-mfa.ps1", { userId: "u-1", dryRun: false, confirmed: true }],
      ["invoke-mfa-action.ps1", { userId: "u-1", action: "push", dryRun: false, confirmed: true }],
      ["invoke-mfa-action.ps1", { userId: "u-1", action: "defaultMethod", method: "fido2", dryRun: false, confirmed: true }],
    ]);
  });

  it("stores the non-secret TAP record in the migrated table", async () => {
    const db = new Database(":memory:");
    runMigrations(db, loadMigrations());
    const store = createTapRecordStore(new SqliteTapRecordRepository(db));
    const saved = await store.save({ tenantId: "t-a", userId: "u-1", createdBy: "admin", lifetimeMinutes: 60, oneTime: true, startTime: null });
    expect(saved).toEqual({ id: expect.any(String), createdAt: expect.any(String) });
    expect(db.prepare("SELECT userId, lifetimeMinutes FROM tap_records").all()).toEqual([{ userId: "u-1", lifetimeMinutes: 60 }]);
  });
});

describe("authentication methods policy provider (T-0818)", () => {
  it("reads the live policy with a get action", async () => {
    const { flat, calls } = harness(() => ({ methods: { id: "fido2", state: "enabled" } }));
    const snapshot = await createAuthMethodsPolicyProvider(flat).getPolicy("t-a");
    expect(calls[0]).toMatchObject({ entrypoint: "set-auth-methods-policy.ps1", job: { action: "get" } });
    expect(snapshot).toEqual({ policy: { methods: [{ id: "fido2", state: "enabled" }] }, retrievedAt: expect.any(String) });
  });

  it("applies a policy confirmed and returns what the worker applied", async () => {
    const policy = { methods: [{ id: "fido2" as const, state: "enabled" as const }] };
    const { flat, calls } = harness(() => ({ status: "succeeded", after: policy }));
    expect(await createAuthMethodsPolicyProvider(flat).applyPolicy("t-a", policy, { dryRun: false })).toEqual({ policy });
    expect(calls[0]!.job).toMatchObject({ action: "apply", policy, dryRun: false, confirmed: true });
  });
});

describe("registration campaign provider (T-0818)", () => {
  it("reads and sets the campaign, normalising unrolled target lists", async () => {
    const { flat, calls } = harness((_e, job) =>
      job["action"] === "get"
        ? { state: "enabled", snoozeDurationInDays: 3, includeTargets: "g-1", excludeTargets: undefined, eligibleUserCount: 0, retrievedAt: "r" }
        : { state: "disabled", snoozeDurationInDays: 1, includeTargets: [], excludeTargets: [], appliedAt: "a" },
    );
    const provider = createRegistrationCampaignProvider(flat);
    expect(await provider.getCampaign("t-a")).toEqual({
      state: "enabled",
      snoozeDurationInDays: 3,
      includeTargets: ["g-1"],
      excludeTargets: [],
      eligibleUserCount: 0,
      retrievedAt: "r",
    });
    await provider.setCampaign("t-a", { state: "disabled", snoozeDurationInDays: 1, includeTargets: [], excludeTargets: ["g-2"] });
    expect(calls[1]!.job).toMatchObject({ action: "set", state: "disabled", excludeTargets: ["g-2"], confirmed: true });
  });
});
