import { describe, expect, it } from "vitest";
import { FeatureWorkerError } from "../jobs/feature-worker.js";
import type { GroupTemplate } from "../repository/group-templates.js";
import type { CredentialRecord, CredentialStoreRow } from "../routes/credentials.js";
import { createGroupProviders } from "./groups.js";
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
  return { providers: createGroupProviders(run, credentials), calls };
}

const TEMPLATE: GroupTemplate = {
  id: "tpl-1",
  name: "Team",
  groupType: "m365",
  naming: { prefix: "", suffix: "", conflictBehavior: "block" } as GroupTemplate["naming"],
  owners: [],
  members: [],
  settings: {},
  licensing: [],
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

describe("group providers (T-0819)", () => {
  it("lists groups with the filter and the tenant's credential block", async () => {
    const { providers, calls } = harness(() => ({ tenantId: "t-a", totalCount: 0, items: [], nextCursor: null }));
    await providers.list.listGroups("t-a", { type: "security", hidden: false, search: "fin", cursor: "40", limit: 20 });
    expect(calls[0]).toEqual({
      entrypoint: "get-groups.ps1",
      job: {
        tenantId: "t-a",
        credential: { credentialRef: "tenants/t-a/credential", record: expect.objectContaining({ thumbprint: "ABC" }) },
        type: "security",
        hidden: false,
        search: "fin",
        top: 20,
        cursor: "40",
      },
    });
  });

  it("reads usage with the inactivity threshold", async () => {
    const { providers, calls } = harness(() => ({ summary: {} }));
    await providers.usage.getUsage("t-a", 30);
    expect(calls[0]).toMatchObject({ entrypoint: "get-group-usage.ps1", job: { inactiveDaysThreshold: 30 } });
  });

  it("sends create, edit, and delete the way the group worker reads them", async () => {
    const { providers, calls } = harness(() => ({ success: true }));
    await providers.crud.createGroup("t-a", { displayName: "Finance", groupType: "dynamic", dynamicRule: "(user.department -eq \"Finance\")" }, true);
    await providers.crud.editGroup("t-a", "g-1", { description: "" }, false);
    await providers.crud.deleteGroup("t-a", "g-1", "Finance", false);
    expect(calls.map((c) => c.job)).toEqual([
      expect.objectContaining({ action: "create", displayName: "Finance", groupType: "dynamic", dynamicRule: "(user.department -eq \"Finance\")", dryRun: true }),
      expect.objectContaining({ action: "edit", groupId: "g-1", description: "", dryRun: false }),
      expect.objectContaining({ action: "delete", groupId: "g-1", confirmName: "Finance", dryRun: false }),
    ]);
    expect(calls.every((c) => c.entrypoint === "set-group.ps1")).toBe(true);
  });

  it("targets GAL and delivery settings separately", async () => {
    const { providers, calls } = harness();
    await providers.gal.setGal("t-a", "g-1", { hiddenFromAddressListsEnabled: true }, true);
    await providers.gal.setDelivery("t-a", "g-1", { requireSenderAuthenticationEnabled: false }, false);
    expect(calls[0]).toMatchObject({ entrypoint: "set-group-gal-delivery.ps1", job: { target: "gal", hiddenFromAddressListsEnabled: true, dryRun: true } });
    expect(calls[1]!.job).toMatchObject({ target: "delivery", requireSenderAuthenticationEnabled: false, grantSendOnBehalfTo: [], dryRun: false });
  });

  it("runs bulk membership with its role and operation", async () => {
    const { providers, calls } = harness();
    await providers.members.invokeBulkMembership("t-a", "g-1", "owners", { operation: "remove", users: ["u1", "u2"] }, true);
    expect(calls[0]).toMatchObject({
      entrypoint: "group-membership-bulk.ps1",
      job: { groupId: "g-1", role: "owners", operation: "remove", users: ["u1", "u2"], dryRun: true },
    });
  });

  it("plans a template deploy per target, reporting a target without a credential as invalid", async () => {
    const { providers, calls } = harness((_e, job) => ({ tenantId: job["tenantId"], targetName: "Team", diff: ["+ group"], valid: true }));
    const plans = await providers.templateDeploy.planDeploy(TEMPLATE, ["t-a", "t-z"], { dept: "Sales" });
    expect(plans).toEqual([
      { tenantId: "t-a", targetName: "Team", diff: ["+ group"], valid: true },
      expect.objectContaining({ tenantId: "t-z", valid: false, conflictError: expect.stringContaining("no credential") }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.job).toMatchObject({ template: TEMPLATE, variables: { dept: "Sales" }, dryRun: true });
  });

  it("deploys per target, turning one tenant's worker failure into a failed deployment", async () => {
    let first = true;
    const run: WorkerRunner = async (_entrypoint, job) => {
      if (first) {
        first = false;
        return {
          plan: {},
          success: true,
          deployment: { id: "dep-1", templateId: "tpl-1", tenantId: "t-a", state: "succeeded", results: [], createdBy: "u", createdAt: "", updatedAt: "" },
          auditEvent: { id: "evt", targetId: "g-9", tenantId: (job as Record<string, unknown>)["tenantId"] },
        } as never;
      }
      throw new FeatureWorkerError("worker.failed", "deploy-group-template.ps1 exited with code 1", 1, "ConflictBlocked: name taken");
    };
    const both: CredentialStoreRow = { ...credentials, getCredential: async (tenantId) => ({ ...CRED, tenantId }) };
    const results = await createGroupProviders(run, both).templateDeploy.executeDeploy(TEMPLATE, ["t-a", "t-b"], {}, "u");
    expect(results[0]).toMatchObject({ targetId: "g-9", tenantId: "t-a", deployment: { state: "succeeded" } });
    expect(results[1]).toMatchObject({
      tenantId: "t-b",
      deployment: { state: "failed", createdBy: "u", results: [{ status: "failed", error: expect.stringContaining("ConflictBlocked") }] },
      auditEvent: { action: "group-template.deploy", result: "failure" },
    });
  });
});
