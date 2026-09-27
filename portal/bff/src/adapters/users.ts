// EPIC-011 users, offboarding, BEC, and user templates (T-0818).
//
// Worker-backed providers call the T-0007 envelope workers (createEnvelopeWorker); the
// route stores map onto the @m365-assess/db repositories, whose shapes match the
// routes' records field for field.
import type {
  BecFindingRepository,
  OffboardingRepository,
  UserTemplateRepository,
} from "@m365-assess/db";
import { AppError } from "../errors.js";
import type {
  BecCheckOutcome,
  BecCheckProvider,
  BecFindingStore,
  BecRemediateProvider,
} from "../routes/bec.js";
import type {
  OffboardingJobRecord,
  OffboardingQueue,
  OffboardingStepRecord,
  OffboardingStore,
} from "../routes/offboarding.js";
import type { UserTemplateStore } from "../routes/user-templates.js";
import type {
  ProviderActionResult,
  ProviderCreateRowResult,
  ProviderPatchOutcome,
  TenantUsersPage,
  TenantUsersProvider,
  UserActionProvider,
  UserCreateProvider,
  UserPatchProvider,
} from "../routes/users.js";
import { asArray, type EnvelopeWorkerCall } from "./workers.js";

export const BEC_REMEDIATION_FAILED = "users.bec_remediation_failed";
export const BEC_MISSING_TARGET = "users.bec_missing_target";

// ---- Users -----------------------------------------------------------------

export interface UserProviders {
  readonly list: TenantUsersProvider;
  readonly create: UserCreateProvider;
  readonly execute: UserActionProvider;
  readonly patch: UserPatchProvider;
}

export function createUserProviders(call: EnvelopeWorkerCall): UserProviders {
  return {
    list: {
      async listUsers(tenantId, filter) {
        const page = await call<TenantUsersPage>("get-tenant-users.ps1", tenantId, {
          filters: {
            ...(filter.search ? { search: filter.search } : {}),
            ...(filter.status ? { status: filter.status } : {}),
            ...(filter.type ? { type: filter.type } : {}),
            ...(filter.license ? { license: filter.license } : {}),
            ...(filter.mfaState ? { mfaState: filter.mfaState } : {}),
            ...(filter.department ? { department: filter.department } : {}),
            ...(filter.inactiveDays !== undefined ? { inactiveDays: filter.inactiveDays } : {}),
            top: filter.limit,
            ...(filter.cursor ? { cursor: filter.cursor } : {}),
          },
        });
        return { items: asArray(page.items), nextCursor: page.nextCursor ?? null };
      },
    },

    create: {
      async createUsers(tenantId, users, options) {
        const rows = await call<ProviderCreateRowResult | ProviderCreateRowResult[] | undefined>(
          "new-tenant-user.ps1",
          tenantId,
          { users, dryRun: options.dryRun },
        );
        return asArray(rows);
      },
    },

    // The route has already required `confirm: true` for the actions that need it.
    execute: {
      executeAction: (tenantId, userId, action, options) =>
        call<ProviderActionResult>("invoke-user-action.ps1", tenantId, {
          userId,
          action,
          ...(options.password ? { password: options.password } : {}),
          dryRun: options.dryRun,
          confirm: true,
        }),
    },

    patch: {
      async patchUsers(tenantId, patches, options) {
        const rows = await call<ProviderPatchOutcome | ProviderPatchOutcome[] | undefined>(
          "set-tenant-user-properties.ps1",
          tenantId,
          { users: patches, preview: options.preview },
        );
        return asArray(rows);
      },
    },
  };
}

// ---- BEC -------------------------------------------------------------------

interface BecRemediationOutput {
  readonly status: "remediated" | "failed";
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly error: string | null;
}

export function createBecProviders(call: EnvelopeWorkerCall): {
  readonly check: BecCheckProvider;
  readonly remediate: BecRemediateProvider;
} {
  return {
    check: {
      async runCheck(tenantId, userId) {
        const result = await call<{ checks?: BecCheckOutcome | BecCheckOutcome[] }>("invoke-bec-check.ps1", tenantId, { userId });
        return asArray(result.checks);
      },
    },

    // removeInboxRule acts on one rule per worker run, so each rule in the finding's
    // evidence gets its own run; other actions need no target. The route has already
    // required `confirm: true`.
    remediate: {
      async remediate(tenantId, userId, finding, action) {
        let targets = [""];
        if (action === "removeInboxRule") {
          const evidence = Array.isArray(finding.detail["evidence"]) ? (finding.detail["evidence"] as unknown[]) : [];
          targets = evidence
            .map((item) => (typeof item === "object" && item !== null ? (item as { id?: unknown }).id : undefined))
            .filter((id): id is string => typeof id === "string" && id.length > 0);
          if (targets.length === 0) {
            throw new AppError(BEC_MISSING_TARGET, `BEC finding ${finding.id} lists no inbox rule to remove`, 409);
          }
        }

        const befores: (Record<string, unknown> | null)[] = [];
        let after: Record<string, unknown> | null = null;
        for (const target of targets) {
          const outcome = await call<BecRemediationOutput>("invoke-bec-check.ps1", tenantId, {
            userId,
            check: finding.check,
            action,
            ...(target ? { target } : {}),
            confirm: true,
          });
          if (outcome.status !== "remediated") {
            const done = befores.length > 0 ? ` after ${befores.length} of ${targets.length} succeeded` : "";
            throw new AppError(BEC_REMEDIATION_FAILED, `${action} failed${done}: ${outcome.error ?? "unknown error"}`, 502);
          }
          befores.push(outcome.before);
          after = outcome.after;
        }
        return { before: targets.length > 1 ? { rules: befores } : (befores[0] ?? null), after };
      },
    },
  };
}

export function createBecFindingStore(repo: BecFindingRepository): BecFindingStore {
  return {
    saveFindings: (findings) => repo.saveBecFindings(findings),
    listFindings: (tenantId, userId) => repo.listBecFindings(tenantId, userId),
    getFinding: (findingId) => repo.getBecFinding(findingId),
    updateFindingState: (findingId, state) => repo.updateBecFindingState(findingId, state),
  };
}

// ---- User templates --------------------------------------------------------

export function createUserTemplateStore(repo: UserTemplateRepository): UserTemplateStore {
  return {
    createUserTemplate: (input) =>
      repo.createUserTemplate({ ...input, licenses: [...input.licenses], groups: [...input.groups] }),
    getUserTemplate: (templateId) => repo.getUserTemplate(templateId),
    listUserTemplates: () => repo.listUserTemplates(),
    updateUserTemplate: (templateId, { licenses, groups, ...rest }) =>
      repo.updateUserTemplate(templateId, {
        ...rest,
        ...(licenses ? { licenses: [...licenses] } : {}),
        ...(groups ? { groups: [...groups] } : {}),
      }),
    softDeleteUserTemplate: (templateId) => repo.softDeleteUserTemplate(templateId),
  };
}

// ---- Offboarding -----------------------------------------------------------

export function createOffboardingStore(repo: OffboardingRepository): OffboardingStore {
  return {
    createJob: (input) => repo.createOffboardingJob({ ...input, userIds: [...input.userIds] }),
    getJob: (jobId) => repo.getOffboardingJob(jobId),
    createSteps: (jobId, actions) => repo.createOffboardingSteps(jobId, actions),
    listSteps: (jobId) => repo.listOffboardingSteps(jobId),
    getStep: (jobId, order) => repo.getOffboardingStep(jobId, order),
    async resetStep(jobId, order) {
      return (await repo.resetOffboardingStep(jobId, order)) ? repo.getOffboardingStep(jobId, order) : undefined;
    },
    updateJobState: (jobId, state) => repo.updateOffboardingJobState(jobId, state),
  };
}

/** One step as the offboarding worker reports it. */
interface WorkerStepRecord {
  readonly order: number;
  readonly state: "succeeded" | "failed";
  readonly result: Record<string, unknown> | null;
  readonly error: string | null;
  readonly appliedAt: string | null;
}

export interface OffboardingRunner extends OffboardingQueue {
  /** Resolves when every run started so far has finished (tests and shutdown). */
  idle(): Promise<void>;
}

/**
 * Runs offboarding jobs in the background. A run executes the requested re-run step
 * (if any), then every step still pending, in one worker run each; the worker stops at
 * the first failed step. Step outcomes are written back as they are reported, and the
 * job ends `completed` only when every step succeeded. A worker that cannot run at all
 * (no credential, a crash) fails the first step it was given, with the reason, so the
 * UI offers a re-run.
 */
export function createOffboardingRunner(call: EnvelopeWorkerCall, repo: OffboardingRepository): OffboardingRunner {
  const running = new Set<Promise<void>>();

  async function record(jobId: string, steps: readonly WorkerStepRecord[]): Promise<void> {
    for (const step of steps) {
      await repo.updateOffboardingStep(jobId, step.order, {
        state: step.state,
        result: step.result,
        error: step.error,
        appliedAt: step.appliedAt,
      });
    }
  }

  async function runWorker(
    job: OffboardingJobRecord,
    steps: readonly OffboardingStepRecord[],
    rerunOrder: number | undefined,
    fallbackOrder: number,
  ): Promise<void> {
    try {
      const output = await call<WorkerStepRecord | { steps?: WorkerStepRecord | WorkerStepRecord[] }>(
        "invoke-user-offboarding.ps1",
        job.tenantId,
        {
          jobId: job.id,
          userIds: job.userIds,
          steps: steps.map(({ order, action }) => ({ order, action })),
          mailboxAccess: job.options["mailboxAccess"] ?? null,
          actor: job.createdBy,
          ...(rerunOrder !== undefined ? { rerunOrder } : {}),
        },
      );
      await record(job.id, rerunOrder !== undefined ? [output as WorkerStepRecord] : asArray((output as { steps?: WorkerStepRecord[] }).steps));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repo.updateOffboardingStep(job.id, fallbackOrder, { state: "failed", error: message, result: null, appliedAt: null });
    }
  }

  async function run(jobId: string, rerunOrder: number | undefined): Promise<void> {
    const job = await repo.getOffboardingJob(jobId);
    if (!job) return;
    await repo.updateOffboardingJobState(jobId, "running");

    const all = await repo.listOffboardingSteps(jobId);
    if (rerunOrder !== undefined) {
      await runWorker(job, all, rerunOrder, rerunOrder);
    }

    const afterRerun = await repo.listOffboardingSteps(jobId);
    const rerunFailed = afterRerun.some((s) => s.order === rerunOrder && s.state === "failed");
    const pending = afterRerun.filter((s) => s.state === "pending");
    if (!rerunFailed && pending.length > 0) {
      await runWorker(job, pending, undefined, pending[0]!.order);
    }

    const final = await repo.listOffboardingSteps(jobId);
    const done = final.every((s) => s.state === "succeeded" || s.state === "skipped");
    await repo.updateOffboardingJobState(jobId, done ? "completed" : "failed");
  }

  return {
    async enqueue(request) {
      const runId = globalThis.crypto.randomUUID();
      const task = run(request.jobId, request.rerunOrder)
        .catch(async () => {
          await repo.updateOffboardingJobState(request.jobId, "failed").catch(() => undefined);
        })
        .finally(() => running.delete(task));
      running.add(task);
      return runId;
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}
