// EPIC-012 MFA, authentication methods policy, and registration campaign (T-0818).
//
// The MFA workers read the T-0007 envelope (createEnvelopeWorker); the policy and
// campaign workers read flat fields (createTenantWorker) and take `action: "get"` for a
// read. Every write route has already required `confirm: true`, so jobs are sent
// confirmed. The TAP record store keeps only the non-secret record.
import type { TapRecordRepository } from "@m365-assess/db";
import type { AuthMethodPolicyShape } from "../domain/auth-methods/presets.js";
import type { AuthMethodsPolicyProvider } from "../routes/auth-methods-policy.js";
import type {
  MfaActionProvider,
  MfaReportProvider,
  MfaResetProvider,
  MfaUserRow,
  ProviderMfaActionOutcome,
  ProviderMfaResetOutcome,
  TapProvider,
  TapRecordStore,
} from "../routes/mfa.js";
import type { CampaignState, RegistrationCampaignProvider } from "../routes/registration-campaign.js";
import { asArray, type EnvelopeWorkerCall, type TenantWorkerCall } from "./workers.js";

export interface MfaProviders {
  readonly report: MfaReportProvider;
  readonly reset: MfaResetProvider;
  readonly tap: TapProvider;
  readonly actions: MfaActionProvider;
}

interface TapWorkerOutput {
  readonly id: string | null;
  readonly status: "applied" | "planned" | "failed";
  readonly expiresAt: string | null;
  readonly temporaryAccessPass: string | null;
  readonly error: string | null;
}

export function createMfaProviders(call: EnvelopeWorkerCall): MfaProviders {
  return {
    report: {
      async getMfaReport(tenantId, filter) {
        const page = await call<{ rows?: MfaUserRow | MfaUserRow[]; nextCursor?: string | null; retrievedAt?: string }>(
          "get-mfa-report.ps1",
          tenantId,
          {
            ...(filter.registered ? { registered: filter.registered } : {}),
            ...(filter.method ? { method: filter.method } : {}),
            ...(filter.phishingResistant !== undefined
              ? { phishingResistant: filter.phishingResistant ? "phishing-resistant" : "not-phishing-resistant" }
              : {}),
            ...(filter.license ? { license: filter.license } : {}),
            ...(filter.adminRole !== undefined ? { adminRole: String(filter.adminRole) } : {}),
            top: filter.limit,
            ...(filter.cursor ? { cursor: filter.cursor } : {}),
          },
        );
        return {
          rows: asArray(page.rows),
          nextCursor: page.nextCursor ?? null,
          retrievedAt: page.retrievedAt ?? new Date().toISOString(),
        };
      },
    },

    reset: {
      resetMfa: (tenantId, userId, options) =>
        call<ProviderMfaResetOutcome>("reset-user-mfa.ps1", tenantId, { userId, dryRun: options.dryRun, confirmed: true }),
    },

    // The worker names the one-time value `temporaryAccessPass`; the route calls it `pass`.
    tap: {
      async createTap(tenantId, userId, input) {
        const out = await call<TapWorkerOutput>("new-temporary-access-pass.ps1", tenantId, {
          userId,
          lifetimeMinutes: input.lifetimeMinutes,
          oneTime: input.oneTime,
          ...(input.startTime ? { startTime: input.startTime } : {}),
          dryRun: input.dryRun,
          confirmed: true,
        });
        return {
          status: out.status === "failed" ? "failed" : "applied",
          id: out.id ?? "",
          expiresAt: out.expiresAt,
          pass: out.temporaryAccessPass,
          error: out.error,
        };
      },
    },

    actions: {
      sendPush: (tenantId, userId, options) =>
        call<ProviderMfaActionOutcome>("invoke-mfa-action.ps1", tenantId, {
          userId,
          action: "push",
          dryRun: options.dryRun,
          confirmed: true,
        }),
      setDefaultMethod: (tenantId, userId, method, options) =>
        call<ProviderMfaActionOutcome>("invoke-mfa-action.ps1", tenantId, {
          userId,
          action: "defaultMethod",
          method,
          dryRun: options.dryRun,
          confirmed: true,
        }),
    },
  };
}

export function createTapRecordStore(repo: TapRecordRepository): TapRecordStore {
  return {
    async save(record) {
      const saved = repo.createTapRecord(record);
      return { id: saved.id, createdAt: saved.createdAt };
    },
  };
}

export function createAuthMethodsPolicyProvider(call: TenantWorkerCall): AuthMethodsPolicyProvider {
  return {
    async getPolicy(tenantId) {
      const policy = await call<AuthMethodPolicyShape>("set-auth-methods-policy.ps1", tenantId, { action: "get" });
      return { policy: { methods: asArray(policy.methods) }, retrievedAt: new Date().toISOString() };
    },
    async applyPolicy(tenantId, policy, options) {
      const result = await call<{ after: AuthMethodPolicyShape }>("set-auth-methods-policy.ps1", tenantId, {
        action: "apply",
        policy,
        dryRun: options.dryRun,
        confirmed: true,
      });
      return { policy: result.after };
    },
  };
}

interface CampaignOutput {
  readonly state: CampaignState;
  readonly snoozeDurationInDays: number;
  readonly includeTargets?: string | string[];
  readonly excludeTargets?: string | string[];
  readonly eligibleUserCount?: number;
  readonly retrievedAt?: string;
  readonly appliedAt?: string;
}

export function createRegistrationCampaignProvider(call: TenantWorkerCall): RegistrationCampaignProvider {
  const shape = (out: CampaignOutput) => ({
    state: out.state,
    snoozeDurationInDays: out.snoozeDurationInDays,
    includeTargets: asArray(out.includeTargets),
    excludeTargets: asArray(out.excludeTargets),
    eligibleUserCount: out.eligibleUserCount ?? 0,
  });
  return {
    async getCampaign(tenantId) {
      const out = await call<CampaignOutput>("set-registration-campaign.ps1", tenantId, { action: "get" });
      return { ...shape(out), retrievedAt: out.retrievedAt ?? new Date().toISOString() };
    },
    async setCampaign(tenantId, config) {
      const out = await call<CampaignOutput>("set-registration-campaign.ps1", tenantId, {
        action: "set",
        state: config.state,
        snoozeDurationInDays: config.snoozeDurationInDays,
        includeTargets: config.includeTargets,
        excludeTargets: config.excludeTargets,
        confirmed: true,
      });
      return { ...shape(out), appliedAt: out.appliedAt ?? new Date().toISOString() };
    },
  };
}
