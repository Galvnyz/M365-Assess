import { describe, expect, it } from "vitest";
import { FeatureWorkerError } from "../jobs/feature-worker.js";
import type { IntuneTemplate } from "../repository/intune-templates.js";
import type { CredentialRecord, CredentialStoreRow } from "../routes/credentials.js";
import { WORKER_FAILED, createIntuneProviders } from "./intune.js";
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

function harness(respond: (entrypoint: string, job: Record<string, unknown>) => unknown = () => ({})) {
  const calls: { entrypoint: string; job: Record<string, unknown> }[] = [];
  const run: WorkerRunner = async (entrypoint, job) => {
    calls.push({ entrypoint, job: job as Record<string, unknown> });
    return respond(entrypoint, job as Record<string, unknown>) as never;
  };
  return { providers: createIntuneProviders(run, credentials), calls };
}

const TEMPLATE: IntuneTemplate = {
  id: "tpl-1",
  name: "Win Baseline",
  platform: "windows10",
  policyType: "compliance",
  policyJson: { displayName: "Win Baseline" },
  assignments: [],
  source: "local",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

describe("Intune providers (T-0820)", () => {
  it("sends every job with the tenant's credential block", async () => {
    const { providers, calls } = harness(() => ({ tenantId: "t-a", kind: "compliance", totalCount: 0, items: [], nextCursor: null }));
    await providers.policies.listPolicies("t-a", "compliance", { platform: "windows", assigned: false, cursor: "20", limit: 10 });
    expect(calls[0]).toEqual({
      entrypoint: "get-intune-policies.ps1",
      job: {
        tenantId: "t-a",
        credential: { credentialRef: "tenants/t-a/credential", record: expect.objectContaining({ thumbprint: "ABC" }) },
        kind: "compliance",
        platform: "windows",
        assigned: false,
        top: 10,
        skipToken: "20",
      },
    });
  });

  it("refuses tenants without a credential before running anything", async () => {
    const { providers, calls } = harness();
    await expect(providers.policies.listPolicies("t-z", "compliance", { cursor: null, limit: 10 })).rejects.toMatchObject({
      status: 409,
      code: "tenant.credential_missing",
    });
    expect(calls).toHaveLength(0);
  });

  it("raises structured worker errors such as unsupported kinds", async () => {
    const { providers } = harness(() => ({ error: "intune.kind.unsupported", message: "not in v1", statusCode: 501 }));
    await expect(providers.policies.listPolicies("t-a", "configuration", { cursor: null, limit: 10 })).rejects.toMatchObject({
      status: 501,
      code: "intune.kind.unsupported",
    });
  });

  it("maps a failed worker to a 502 with its first diagnostic line", async () => {
    const run: WorkerRunner = async () => {
      throw new FeatureWorkerError("worker.failed", "set-intune-policy.ps1 exited with code 1", 1, "\nGraph 403: Forbidden\nat line 3");
    };
    const providers = createIntuneProviders(run, credentials);
    await expect(
      providers.crud.createPolicy("t-a", "compliance", { displayName: "x", platform: "windows", preview: true }, true),
    ).rejects.toMatchObject({ status: 502, code: WORKER_FAILED, message: expect.stringContaining("Graph 403: Forbidden") });
  });

  it("serialises policy CRUD inputs the way Set-IntunePolicy reads them", async () => {
    const { providers, calls } = harness(() => ({ success: true, plan: {} }));
    await providers.crud.editPolicy(
      "t-a",
      "compliance",
      "p-1",
      { displayName: "Renamed", settings: { passwordRequired: true }, assignments: [{ id: "g" }], preview: true },
      true,
    );
    await providers.crud.deletePolicy("t-a", "compliance", "p-1", "Renamed", false);
    expect(calls[0]!.job).toMatchObject({
      kind: "compliance",
      action: "edit",
      policyId: "p-1",
      displayName: "Renamed",
      settingsJson: '{"passwordRequired":true}',
      assignmentsJson: '[{"id":"g"}]',
      dryRun: true,
    });
    expect(calls[1]!.job).toMatchObject({ action: "delete", policyId: "p-1", confirmName: "Renamed", dryRun: false });
  });

  it("plans and applies template deploys with the template and drawer options", async () => {
    const { providers, calls } = harness((_e, job) => (job["dryRun"] ? { success: true, plan: { tenantId: "t-a", valid: true } } : { tenantId: "t-a", state: "succeeded", steps: [] }));
    const options = { assignmentMode: "groups", groups: ["Pilot"], policyState: "enabled", overwrite: true, createGroups: false } as const;
    expect(await providers.deploy.planTarget(TEMPLATE, "t-a", options)).toEqual({ tenantId: "t-a", valid: true });
    expect(await providers.deploy.deployTarget(TEMPLATE, "t-a", options, "user-1")).toMatchObject({ state: "succeeded" });
    expect(calls[0]!.job).toMatchObject({ templateJson: JSON.stringify(TEMPLATE), assignmentMode: "groups", groups: ["Pilot"], overwrite: true, dryRun: true });
    expect(calls[1]!.job).toMatchObject({ dryRun: false, actor: "user-1" });
  });

  it("lists and syncs reusable settings", async () => {
    const { providers, calls } = harness((_e, job) => (job["action"] === "list" ? { tenantId: "t-a", items: [{ id: "s-1" }] } : { tenantId: "t-a", preview: true, changes: [], results: [], auditEvents: [] }));
    expect(await providers.reusableSettings.listSettings("t-a")).toEqual([{ id: "s-1" }]);
    await providers.reusableSettings.sync("t-a", [], { preview: true, actor: "u" });
    expect(calls[1]).toMatchObject({ entrypoint: "sync-reusable-settings.ps1", job: { action: "sync", templatesJson: "[]", dryRun: true, actor: "u" } });
  });

  it("drives Set-AssignmentFilter actions", async () => {
    const { providers, calls } = harness((_e, job) => (job["action"] === "list" ? { items: [] } : {}));
    await providers.assignmentFilters.list("t-a");
    await providers.assignmentFilters.create("t-a", { displayName: "x", platform: "iOS", rule: "r" }, "u");
    await providers.assignmentFilters.remove("t-a", "f-1", "x", "u");
    await providers.assignmentFilters.planDeploy("t-a", { displayName: "x", platform: "iOS", rule: "r" });
    expect(calls.map((c) => c.job["action"])).toEqual(["list", "create", "delete", "plan"]);
    expect(calls[1]!.job["filterJson"]).toBe('{"displayName":"x","platform":"iOS","rule":"r"}');
    expect(calls[2]!.job).toMatchObject({ filterId: "f-1", confirmName: "x" });
  });

  it("reads a single policy for compare, mapping null to not found", async () => {
    const { providers, calls } = harness((_e, job) => (job["policyId"] === "p-1" ? { id: "p-1", displayName: "A", platform: "windows", body: {}, assignments: [] } : null));
    expect(await providers.compare.getPolicy("t-a", "compliance", "p-1")).toMatchObject({ id: "p-1" });
    expect(await providers.compare.getPolicy("t-a", "compliance", "missing")).toBeUndefined();
    expect(calls[0]!.job).toMatchObject({ kind: "compliance", policyId: "p-1" });
  });

  it("reveals device keys through their job-file entrypoints", async () => {
    const { providers, calls } = harness(() => ({ keys: [] }));
    await providers.bitlocker.getKeys("t-a", "d-1");
    await providers.laps.getCredentials("t-a", "d-1");
    expect(calls.map((c) => [c.entrypoint, c.job["deviceId"]])).toEqual([
      ["get-bitlocker-keys.ps1", "d-1"],
      ["get-laps-credentials.ps1", "d-1"],
    ]);
  });
});
