import { SqliteRepository, loadMigrations, runMigrations } from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { CaTemplate } from "../repository/ca-templates.js";
import type { CredentialRecord, CredentialStoreRow } from "../routes/credentials.js";
import { createAuditSink } from "./audit.js";
import { createCaProviders, readCaHistory } from "./conditional-access.js";
import type { WorkerRunner } from "./workers.js";

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

function migrated() {
  const db = new Database(":memory:");
  const version = runMigrations(db, loadMigrations());
  return { db, repo: new SqliteRepository(db, version, "memory") };
}

function harness(respond: (entrypoint: string, job: Record<string, unknown>) => unknown = () => ({})) {
  const calls: { entrypoint: string; job: Record<string, unknown> }[] = [];
  const run: WorkerRunner = async (entrypoint, job) => {
    calls.push({ entrypoint, job: job as Record<string, unknown> });
    return respond(entrypoint, job as Record<string, unknown>) as never;
  };
  return { providers: createCaProviders(run, credentials, new Database(":memory:")), calls };
}

const TEMPLATE: CaTemplate = {
  id: "ca-tpl",
  name: "Require MFA",
  policyJson: { displayName: "Require MFA" },
  source: "local",
  category: null,
  version: 1,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
} as CaTemplate;

describe("Conditional Access providers (T-0819)", () => {
  it("lists policies with the filter and the tenant's credential block", async () => {
    const { providers, calls } = harness(() => ({ tenantId: "t-a", totalCount: 0, items: [], nextCursor: null }));
    await providers.policies.listPolicies("t-a", { state: "enabled", control: "mfa", cursor: null, limit: 50 });
    expect(calls[0]).toEqual({
      entrypoint: "get-ca-policies.ps1",
      job: {
        tenantId: "t-a",
        credential: { credentialRef: "tenants/t-a/credential", record: expect.objectContaining({ thumbprint: "ABC" }) },
        state: "enabled",
        control: "mfa",
        top: 50,
      },
    });
  });

  it("refuses tenants without a credential before running anything", async () => {
    const { providers, calls } = harness();
    await expect(providers.coverage.getCoverage("t-z")).rejects.toMatchObject({ status: 409, code: "tenant.credential_missing" });
    expect(calls).toHaveLength(0);
  });

  it("serialises policy parts as the JSON strings the CA policy worker reads", async () => {
    const { providers, calls } = harness(() => ({ success: true }));
    const grantControls = { operator: "OR", builtInControls: ["mfa"] };
    await providers.crud.createPolicy("t-a", { displayName: "Require MFA", state: "enabledForReportingButNotEnforced", grantControls }, true);
    await providers.crud.editPolicy("t-a", "pol-1", { state: "enabled" }, false);
    await providers.crud.deletePolicy("t-a", "pol-1", "Require MFA", false);
    expect(calls[0]).toMatchObject({
      entrypoint: "set-ca-policy.ps1",
      job: { action: "create", displayName: "Require MFA", grantControlsJson: JSON.stringify(grantControls), dryRun: true },
    });
    expect(calls[0]!.job).not.toHaveProperty("conditionsJson");
    expect(calls[1]!.job).toMatchObject({ action: "edit", policyId: "pol-1", state: "enabled", dryRun: false });
    expect(calls[2]!.job).toMatchObject({ action: "delete", policyId: "pol-1", confirmName: "Require MFA" });
  });

  it("reads coverage and report-only evaluation", async () => {
    const { providers, calls } = harness(() => ({ tenantId: "t-a" }));
    await providers.coverage.getCoverage("t-a");
    await providers.reportOnly.getReportOnlyEvaluation("t-a", { policyId: "pol-1" });
    expect(calls.map((c) => c.entrypoint)).toEqual(["get-ca-coverage.ps1", "get-ca-report-only.ps1"]);
    expect(calls[1]!.job).toMatchObject({ policyId: "pol-1" });
  });

  it("leaves unset named-location flags out of an edit so the worker keeps them", async () => {
    const { providers, calls } = harness(() => ({ success: true }));
    await providers.namedLocations.listLocations("t-a");
    await providers.namedLocations.createLocation("t-a", { displayName: "HQ", locationType: "ip", ipRanges: ["10.0.0.0/8"], isTrusted: true }, true);
    await providers.namedLocations.editLocation("t-a", "loc-1", { displayName: "HQ 2" }, false);
    await providers.namedLocations.deleteLocation("t-a", "loc-1", "HQ 2");
    expect(calls.map((c) => c.job["action"])).toEqual(["list", "create", "edit", "delete"]);
    expect(calls[1]!.job).toMatchObject({ locationType: "ip", ipRanges: ["10.0.0.0/8"], isTrusted: true, dryRun: true });
    expect(calls[2]!.job).toMatchObject({ locationId: "loc-1", displayName: "HQ 2", dryRun: false });
    for (const key of ["isTrusted", "includeUnknownCountriesAndRegions", "countryLookupMethod", "ipRanges"]) {
      expect(calls[2]!.job).not.toHaveProperty(key);
    }
    expect(calls[3]!.job).toMatchObject({ confirmName: "HQ 2", dryRun: false });
  });

  it("plans and deploys a template with the drawer options", async () => {
    const { providers, calls } = harness((_e, job) => (job["dryRun"] ? { success: true, plan: { valid: true } } : { success: true, plan: {}, auditEvent: {} }));
    const options = { tenantId: "t-a", policyState: "enabled", breakGlassExclusions: ["bg-1"], overwrite: true };
    expect(await providers.templateDeploy.planDeploy(TEMPLATE, options)).toEqual({ valid: true });
    expect(await providers.templateDeploy.executeDeploy(TEMPLATE, options)).toMatchObject({ success: true });
    expect(calls[0]).toMatchObject({
      entrypoint: "deploy-ca-template.ps1",
      job: {
        tenantId: "t-a",
        templateId: "ca-tpl",
        templateJson: JSON.stringify(TEMPLATE),
        policyState: "enabled",
        breakGlassExclusions: ["bg-1"],
        overwrite: true,
        createGroups: false,
        dryRun: true,
      },
    });
    expect(calls[1]!.job).toMatchObject({ dryRun: false });
  });
});

describe("CA change history (T-0819)", () => {
  it("serves the portal's CA policy changes for a tenant, newest first", async () => {
    const { db, repo } = migrated();
    const record = createAuditSink(repo);
    await record({ id: "e1", tenantId: "t-a", action: "ca.policy.create", targetId: "pol-1", actor: "u1", timestamp: "2026-09-01T00:00:00Z", after: { displayName: "Require MFA" } });
    await record({ id: "e2", tenantId: "t-a", action: "ca.policy.delete", targetId: "pol-1", actor: "u2", timestamp: "2026-09-02T00:00:00Z", before: { displayName: "Require MFA" } });
    await record({ id: "e3", tenantId: "t-a", action: "ca.template.deploy", targetId: "pol-2", timestamp: "2026-09-03T00:00:00Z" });
    await record({ id: "e4", tenantId: "t-a", action: "ca.namedLocation.create", targetId: "loc-1", timestamp: "2026-09-04T00:00:00Z" });
    await record({ id: "e5", tenantId: "t-b", action: "ca.policy.create", targetId: "pol-9", timestamp: "2026-09-05T00:00:00Z" });

    const all = readCaHistory(db, "t-a");
    expect(all.items.map((i) => i.id)).toEqual(["e3", "e2", "e1"]);
    expect(all.items[2]).toMatchObject({ policyId: "pol-1", policyName: "Require MFA", initiatedBy: "u1", source: "portal" });
    expect(all.items[1]).toMatchObject({ policyName: "Require MFA", after: null });
    expect(all.items[0]).toMatchObject({ policyName: "pol-2", initiatedBy: "unknown" });

    const one = readCaHistory(db, "t-a", "pol-1");
    expect(one).toMatchObject({ tenantId: "t-a", policyId: "pol-1", totalCount: 2 });
  });
});
