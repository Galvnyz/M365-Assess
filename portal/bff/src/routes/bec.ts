// BEC compromise check and per-finding remediation (EPIC-011 SPEC.md §3.2,
// §4.5 US-6; T-0207).
//
// The BEC tab runs the 11-check review (mailbox rules, recently added users,
// new applications, mailbox permission changes, sent messages, MFA devices,
// password changes, trusted and blocked senders, Intune devices, sign-in
// locations, sharing links). Findings carry their evidence and a remediate
// action; remediation is per-finding manual approval only — the portal never
// auto-remediates (§11.3 resolved). Automated remediations (remove inbox rule,
// revoke sessions) run through the injected provider after explicit
// confirmation; manual-only findings carry recommended steps instead and the
// remediate route refuses them. Every check and every remediation is audited;
// the check itself performs no tenant write.
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const BEC_CHECK_PATH = "/v1/tenants/:tenantId/users/:userId/bec-check";
export const BEC_FINDINGS_PATH = "/v1/tenants/:tenantId/users/:userId/bec-findings";
export const BEC_REMEDIATE_PATH = "/v1/tenants/:tenantId/users/:userId/bec-findings/:findingId/remediate";

export const BEC_PERMISSION = "Identity.User.ReadWrite";

export const BEC_UNAUTHENTICATED = "request.unauthenticated";
export const BEC_FINDING_NOT_FOUND = "users.bec_finding_not_found";
export const BEC_MANUAL_ONLY = "users.bec_manual_only";
export const BEC_CONFIRM_REQUIRED = "users.bec_confirm_required";
export const BEC_UNAVAILABLE = "users.bec_unavailable";

export const BEC_CHECKS = [
  "mailboxRules",
  "recentUsers",
  "newApplications",
  "mailboxPermissions",
  "sentMessages",
  "mfaDevices",
  "passwordChanges",
  "mailFlow",
  "intuneDevices",
  "signinLocations",
  "sharingLinks",
] as const;

export type BecCheckName = (typeof BEC_CHECKS)[number];

export type BecCheckState = "clear" | "review" | "finding" | "unknown";

export interface BecRemediation {
  readonly action: string;
  readonly automated: boolean;
  readonly label: string;
  readonly steps: readonly string[];
}

export interface BecCheckOutcome {
  readonly check: BecCheckName;
  readonly state: BecCheckState;
  readonly detail: Record<string, unknown>;
  readonly evidence: readonly unknown[];
  readonly remediation: BecRemediation | null;
}

export type BecFindingState = "open" | "remediated" | "dismissed";

export interface BecFindingRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly check: string;
  readonly detail: Record<string, unknown>;
  readonly state: BecFindingState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BecRemediateResult {
  readonly findingId: string;
  readonly state: BecFindingState;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

// Queue-backed seam for the read-only check: the production wiring enqueues
// an Invoke-BecCheck worker job for (tenantId, userId) and serves the 11
// check outcomes. Depending on the seam keeps Graph code out of the BFF.
export interface BecCheckProvider {
  runCheck(tenantId: string, userId: string): Promise<readonly BecCheckOutcome[]>;
}

export interface BecFindingStore {
  saveFindings(findings: readonly BecFindingRecord[]): Promise<readonly BecFindingRecord[]>;
  listFindings(tenantId: string, userId: string): Promise<readonly BecFindingRecord[]>;
  getFinding(findingId: string): Promise<BecFindingRecord | undefined>;
  updateFindingState(findingId: string, state: BecFindingState): Promise<BecFindingRecord | undefined>;
}

// Seam for one automated per-finding remediation behind the EPIC-006 gate.
export interface BecRemediateProvider {
  remediate(
    tenantId: string,
    userId: string,
    finding: BecFindingRecord,
    action: string,
  ): Promise<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null }>;
}

export interface BecAuditEvent {
  readonly tenantId: string;
  readonly action: "users.bec_check" | "users.bec_remediate";
  readonly targetId: string;
  readonly check: string | null;
  readonly result: "success" | "failure";
  readonly error: string | null;
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface BecCaller extends Caller {
  readonly userId?: string;
}

export type BecAuthorizer = (
  caller: BecCaller,
  permission: string,
) => void | Promise<void>;

export interface BecRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface BecRouteOptions {
  readonly provider: BecCheckProvider;
  readonly store: BecFindingStore;
  readonly remediate?: BecRemediateProvider;
  readonly resolveCaller: (ctx: RequestContext) => BecCaller | undefined;
  readonly authorize?: BecAuthorizer;
  readonly readBody?: (ctx: BecRequestContext) => unknown;
  readonly recordAudit?: (event: BecAuditEvent) => Promise<void>;
  readonly idGenerator?: () => string;
  readonly now?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(BEC_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => BecCaller | undefined,
  ctx: RequestContext,
): BecCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function requireTenantParam(ctx: RequestContext): string {
  const value = ctx.params["tenantId"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400, [
      { field: "tenantId", reason: "required" },
    ]);
  }
  return value.trim();
}

function requireUserParam(ctx: RequestContext): string {
  const value = ctx.params["userId"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "userId is required", 400, [
      { field: "userId", reason: "required" },
    ]);
  }
  return value.trim();
}

function readJsonBody(
  ctx: RequestContext,
  readBody: ((ctx: BecRequestContext) => unknown) | undefined,
): Record<string, unknown> {
  let body = readBody ? readBody(ctx as BecRequestContext) : (ctx as BecRequestContext).body;
  if (body === undefined) {
    return {};
  }
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw new AppError(ErrorCodes.validationFailed, "request body is not valid JSON", 400, [
        { field: "body", reason: "invalid_json" },
      ]);
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError(ErrorCodes.validationFailed, "request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return body as Record<string, unknown>;
}

function validateCheckOutcomes(outcomes: readonly BecCheckOutcome[]): void {
  const names = new Set<string>();
  for (const outcome of outcomes) {
    if (!(BEC_CHECKS as readonly string[]).includes(outcome.check)) {
      throw validationError(`unknown BEC check '${outcome.check}'`, "check");
    }
    if (names.has(outcome.check)) {
      throw validationError(`duplicate BEC check '${outcome.check}'`, "check");
    }
    names.add(outcome.check);
    if (!["clear", "review", "finding", "unknown"].includes(outcome.state)) {
      throw validationError(`BEC check '${outcome.check}' has an invalid state`, "check");
    }
  }
  for (const name of BEC_CHECKS) {
    if (!names.has(name)) {
      throw validationError(`BEC check '${name}' is missing from the result`, "check");
    }
  }
}

export async function postBecCheck(
  options: BecRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: BecCaller,
  userId: string,
): Promise<{ status: number; body: { findings: readonly BecFindingRecord[]; checks: readonly BecCheckOutcome[] } }> {
  const outcomes = await options.provider.runCheck(tenantId, userId);
  validateCheckOutcomes(outcomes);
  const now = options.now ?? (() => new Date().toISOString());
  const generateId = options.idGenerator ?? randomUUID;
  const instant = now();
  const persistable = outcomes
    .filter((outcome) => outcome.state === "finding" || outcome.state === "review")
    .map((outcome) => ({
      id: generateId(),
      tenantId,
      userId,
      check: outcome.check,
      detail: {
        state: outcome.state,
        detail: outcome.detail,
        evidence: [...outcome.evidence],
        remediation: outcome.remediation,
      },
      state: "open" as BecFindingState,
      createdAt: instant,
      updatedAt: instant,
    }));
  const findings = await options.store.saveFindings(persistable);
  if (options.recordAudit) {
    await options.recordAudit({
      tenantId,
      action: "users.bec_check",
      targetId: userId,
      check: null,
      result: "success",
      error: null,
      actorUserId: caller.userId ?? null,
      correlationId: ctx.correlationId,
      createdAt: instant,
    });
  }
  return { status: 200, body: { findings, checks: [...outcomes] } };
}

export async function postBecRemediate(
  options: BecRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: BecCaller,
  userId: string,
  findingId: string,
): Promise<{ status: number; body: BecRemediateResult & { finding: BecFindingRecord } }> {
  const finding = await options.store.getFinding(findingId);
  if (
    finding === undefined ||
    finding.tenantId !== tenantId ||
    finding.userId !== userId ||
    finding.state !== "open"
  ) {
    throw new AppError(BEC_FINDING_NOT_FOUND, `open BEC finding ${findingId} was not found`, 404);
  }
  const remediation = (finding.detail["remediation"] ?? null) as BecRemediation | null;
  if (remediation === null || remediation.automated !== true) {
    throw new AppError(
      BEC_MANUAL_ONLY,
      `BEC finding ${findingId} requires manual review and has no automated remediation`,
      400,
      [{ field: "findingId", reason: "manual_only" }],
    );
  }
  const body = readJsonBody(ctx, options.readBody);
  if (body["confirm"] !== true) {
    throw new AppError(
      BEC_CONFIRM_REQUIRED,
      `remediating BEC finding ${findingId} requires { "confirm": true }`,
      400,
      [{ field: "confirm", reason: "required" }],
    );
  }
  if (options.remediate === undefined) {
    throw new AppError(BEC_UNAVAILABLE, "BEC remediation is not wired for this tenant", 501);
  }
  const outcome = await options.remediate.remediate(tenantId, userId, finding, remediation.action);
  const updated =
    (await options.store.updateFindingState(findingId, "remediated")) ?? finding;
  const now = options.now ?? (() => new Date().toISOString());
  if (options.recordAudit) {
    await options.recordAudit({
      tenantId,
      action: "users.bec_remediate",
      targetId: userId,
      check: finding.check,
      result: "success",
      error: null,
      actorUserId: caller.userId ?? null,
      correlationId: ctx.correlationId,
      createdAt: now(),
    });
  }
  return {
    status: 200,
    body: { findingId, state: updated.state, before: outcome.before, after: outcome.after, finding: updated },
  };
}

export function createBecRoutes(options: BecRouteOptions): Route[] {
  const checkHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, BEC_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const userId = requireUserParam(ctx);
    const result = await postBecCheck(options, ctx, tenantId, caller, userId);
    return { status: result.status, body: result.body };
  };
  const findingsHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, BEC_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const userId = requireUserParam(ctx);
    const findings = await options.store.listFindings(tenantId, userId);
    return { status: 200, body: { findings: [...findings] } };
  };
  const remediateHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, BEC_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const userId = requireUserParam(ctx);
    const findingId = ctx.params["findingId"] ?? "";
    if (findingId.trim().length === 0) {
      throw validationError("findingId is required", "findingId");
    }
    const result = await postBecRemediate(options, ctx, tenantId, caller, userId, findingId.trim());
    return { status: result.status, body: result.body };
  };
  return [
    { method: "POST", path: BEC_CHECK_PATH, handler: checkHandler },
    { method: "GET", path: BEC_FINDINGS_PATH, handler: findingsHandler },
    { method: "POST", path: BEC_REMEDIATE_PATH, handler: remediateHandler },
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const BEC_OPENAPI = {
  paths: {
    "/tenants/{tenantId}/users/{userId}/bec-check": {
      post: {
        operationId: "runBecCheck",
        summary: "Run the 11-check BEC compromise review with per-finding remediation",
        permission: BEC_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "All 11 checks with per-check detail, evidence, and finding state." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.bec or the tenant is out of scope." },
        },
      },
    },
    "/tenants/{tenantId}/users/{userId}/bec-findings": {
      get: {
        operationId: "listBecFindings",
        summary: "List persisted BEC findings for a user",
        permission: BEC_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Persisted BEC findings." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.bec or the tenant is out of scope." },
        },
      },
    },
    "/tenants/{tenantId}/users/{userId}/bec-findings/{findingId}/remediate": {
      post: {
        operationId: "remediateBecFinding",
        summary: "Apply one automated per-finding remediation after explicit confirmation",
        permission: BEC_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
          { name: "findingId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The remediated finding with before/after capture." },
          "400": { description: "Manual-only finding, missing confirmation, or invalid body." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.bec or the tenant is out of scope." },
          "404": { description: "No open finding with that id for the user." },
          "501": { description: "BEC remediation is not wired for this tenant." },
        },
      },
    },
  },
} as const;
