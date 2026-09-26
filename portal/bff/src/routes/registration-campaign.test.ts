import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import {
  createRegistrationCampaignRoute,
  parseCampaignInput,
  type RegistrationCampaignAuditEvent,
  type RegistrationCampaignCaller,
  type RegistrationCampaignConfig,
  type RegistrationCampaignProvider,
} from "./registration-campaign.js";

function makeCaller(roles: string[] = ["mfa.admin"], tenantId = "tenant-a"): RegistrationCampaignCaller {
  return {
    sub: "user-1",
    roles,
    tenantScope: { all: false, tenantIds: [tenantId] },
    userId: "user-1",
  };
}

describe("registration-campaign route (T-0226)", () => {
  const sampleState = {
    state: "enabled" as const,
    snoozeDurationInDays: 2,
    includeTargets: ["grp-1", "grp-2"],
    excludeTargets: ["grp-3"],
    eligibleUserCount: 42,
    retrievedAt: "2026-09-26T12:00:00Z",
  };

  it("parseCampaignInput validates state, snoozeDurationInDays, and targets", () => {
    expect(() => parseCampaignInput({})).toThrow(AppError);
    expect(() => parseCampaignInput({ state: "invalid" })).toThrow(AppError);
    expect(() => parseCampaignInput({ state: "enabled", snoozeDurationInDays: 0 })).toThrow(AppError);
    expect(() => parseCampaignInput({ state: "enabled", snoozeDurationInDays: 15 })).toThrow(AppError);

    const valid = parseCampaignInput({
      state: "enabled",
      snoozeDurationInDays: 5,
      includeTargets: ["grp-1"],
      excludeTargets: ["grp-2"],
      confirm: true,
      reason: "security rollout",
    });
    expect(valid.config.state).toBe("enabled");
    expect(valid.config.snoozeDurationInDays).toBe(5);
    expect(valid.config.includeTargets).toEqual(["grp-1"]);
    expect(valid.config.excludeTargets).toEqual(["grp-2"]);
    expect(valid.confirm).toBe(true);
    expect(valid.reason).toBe("security rollout");
  });

  it("GET returns Graph state and eligible user count", async () => {
    const provider: RegistrationCampaignProvider = {
      getCampaign: async () => sampleState,
      setCampaign: async () => ({ ...sampleState, appliedAt: "2026-09-26T12:05:00Z" }),
    };

    const routes = createRegistrationCampaignRoute({
      provider,
      resolveCaller: () => makeCaller(),
    });
    const getRoute = routes.find((r) => r.method === "GET")!;

    const response = await getRoute.handler({
      correlationId: "c-1",
      method: "GET",
      path: "/v1/tenants/tenant-a/registration-campaign",
      params: { tenantId: "tenant-a" },
      query: new URLSearchParams(),
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tenantId: "tenant-a",
      ...sampleState,
    });
  });

  it("PUT updates campaign, verifies confirm and reason, and audits", async () => {
    let appliedConfig: RegistrationCampaignConfig | null = null;
    const audited: RegistrationCampaignAuditEvent[] = [];

    const provider: RegistrationCampaignProvider = {
      getCampaign: async () => sampleState,
      setCampaign: async (_t, config) => {
        appliedConfig = config;
        return {
          ...config,
          eligibleUserCount: 10,
          appliedAt: "2026-09-26T12:10:00Z",
        };
      },
    };

    const routes = createRegistrationCampaignRoute({
      provider,
      resolveCaller: () => makeCaller(),
      recordAudit: async (ev) => {
        audited.push(ev);
      },
    });
    const putRoute = routes.find((r) => r.method === "PUT")!;

    // Fails without confirm
    await expect(
      putRoute.handler({
        correlationId: "c-2",
        method: "PUT",
        path: "/v1/tenants/tenant-a/registration-campaign",
        params: { tenantId: "tenant-a" },
        query: new URLSearchParams(),
        headers: {},
        body: {
          state: "disabled",
          confirm: false,
          reason: "testing",
        },
      } as any),
    ).rejects.toThrow("confirm: true");

    // Succeeds with confirm and reason
    const response = await putRoute.handler({
      correlationId: "c-3",
      method: "PUT",
      path: "/v1/tenants/tenant-a/registration-campaign",
      params: { tenantId: "tenant-a" },
      query: new URLSearchParams(),
      headers: {},
      body: {
        state: "disabled",
        snoozeDurationInDays: 3,
        includeTargets: ["grp-all"],
        excludeTargets: [],
        confirm: true,
        reason: "rollout complete",
      },
    } as any);

    expect(response.status).toBe(200);
    expect(appliedConfig).toEqual({
      state: "disabled",
      snoozeDurationInDays: 3,
      includeTargets: ["grp-all"],
      excludeTargets: [],
    });
    expect(audited).toHaveLength(1);
    expect(audited[0].action).toBe("mfa.registrationCampaign");
    expect(audited[0].reason).toBe("rollout complete");
  });

  it("enforces tenant scope and authentication", async () => {
    const provider: RegistrationCampaignProvider = {
      getCampaign: async () => sampleState,
      setCampaign: async () => ({ ...sampleState, appliedAt: "2026-09-26T12:00:00Z" }),
    };

    const routes = createRegistrationCampaignRoute({
      provider,
      resolveCaller: () => undefined,
    });
    const getRoute = routes.find((r) => r.method === "GET")!;

    await expect(
      getRoute.handler({
        correlationId: "c-4",
        method: "GET",
        path: "/v1/tenants/tenant-a/registration-campaign",
        params: { tenantId: "tenant-a" },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toThrow(AppError);
  });
});
