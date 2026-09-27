// Tenant onboarding route (EPIC-002 SPEC.md §4.1, §6, §8, §10).
// POST /v1/tenants/{id}/onboard invokes Grant-M365AssessConsent via the worker pool.
// High-impact setup write: requires explicit confirmation and `Tenant.Administration.ReadWrite` permission.
// An unconfirmed path is rejected with 400 and never invokes the worker with -Force.
// Success records an audit event with before/after and stores a credential reference.
// Partial or half-provisioned failures still record an audit event and return a precise error.

import { randomUUID } from "node:crypto";
import { formatThumbprintRef } from "../credentials/store.js";
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route } from "../server.js";
import type { CredentialStoreRow } from "./credentials.js";
import type { TenantAuditInput, TenantRecord, TenantStore } from "./tenants.js";

export const ONBOARD_PATH = "/v1/tenants/:id/onboard";
export const ONBOARD_PERMISSION = "Tenant.Administration.ReadWrite";

export const ONBOARD_CONFIRMATION_REQUIRED = "onboard.confirmation_required";
export const ONBOARD_FAILED = "onboard.failed";
export const ONBOARD_PARTIAL_FAILURE = "onboard.partial_failure";
export const ONBOARD_UNAUTHENTICATED = "request.unauthenticated";

export interface OnboardInput {
  readonly confirmed?: boolean;
  readonly adminUpn?: string;
  readonly appDisplayName?: string;
  readonly clientId?: string;
  readonly certificateThumbprint?: string;
  readonly createNew?: boolean;
  readonly displayName?: string | null;
  readonly defaultDomain?: string | null;
  readonly initialDomain?: string | null;
  readonly environment?: string;
}

export interface OnboardWorkerResult {
  readonly tenantId: string;
  readonly status: "succeeded" | "partial" | "failed";
  readonly clientId?: string | null;
  readonly certificateThumbprint?: string | null;
  readonly appDisplayName?: string | null;
  readonly bootstrapCreated?: boolean;
  readonly totalFailed?: number;
  readonly error?: string | null;
  readonly completedAt?: string;
}

export type OnboardRunner = (
  tenantId: string,
  input: OnboardInput,
) => Promise<OnboardWorkerResult>;

export interface OnboardCaller extends Caller {
  readonly userId?: string;
}

export type OnboardAuthorizer = (
  caller: OnboardCaller,
  permission: string,
) => void | Promise<void>;

export interface OnboardRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface OnboardRouteOptions {
  readonly tenantStore: TenantStore;
  readonly credentialStore?: CredentialStoreRow;
  readonly runner: OnboardRunner;
  readonly resolveCaller: (ctx: RequestContext) => OnboardCaller | undefined;
  readonly authorize?: OnboardAuthorizer;
  readonly readBody?: (ctx: OnboardRequestContext) => unknown;
  readonly now?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(ONBOARD_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => OnboardCaller | undefined,
  ctx: RequestContext,
): OnboardCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function extractTenantId(ctx: RequestContext): string {
  const rawId = ctx.params["id"] ?? ctx.params["tenantId"];
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenant id is required", 400);
  }
  return rawId.trim();
}

function parseJsonObject(ctx: OnboardRequestContext, readBody?: (ctx: OnboardRequestContext) => unknown): Record<string, unknown> {
  let body = readBody ? readBody(ctx) : ctx.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw new AppError(ErrorCodes.validationFailed, "request body is not valid JSON", 400);
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError(ErrorCodes.validationFailed, "request body must be a JSON object", 400);
  }
  return body as Record<string, unknown>;
}

export function createOnboardRoutes(options: OnboardRouteOptions): Route[] {
  const now = options.now ?? (() => new Date().toISOString());
  const authorize: OnboardAuthorizer =
    options.authorize ??
    ((caller, perm) => {
      if (!caller.roles.includes("admin")) {
        throw new AppError("rbac.forbidden", `permission ${perm} required (admin only)`, 403);
      }
    });

  return [
    {
      method: "POST",
      path: ONBOARD_PATH,
      handler: async (ctx: RequestContext) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = extractTenantId(ctx);
        requireTenantInScope(caller, tenantId);
        await authorize(caller, ONBOARD_PERMISSION);

        const bodyObj = parseJsonObject(ctx as OnboardRequestContext, options.readBody);
        const confirmed = bodyObj["confirmed"] === true || bodyObj["confirm"] === true;
        if (!confirmed) {
          throw new AppError(
            ONBOARD_CONFIRMATION_REQUIRED,
            "onboarding is a tenant-mutating setup action and requires explicit confirmation (confirmed: true)",
            400,
          );
        }

        const input: OnboardInput = {
          confirmed: true,
          adminUpn: typeof bodyObj["adminUpn"] === "string" ? bodyObj["adminUpn"] : undefined,
          appDisplayName:
            typeof bodyObj["appDisplayName"] === "string" ? bodyObj["appDisplayName"] : undefined,
          clientId: typeof bodyObj["clientId"] === "string" ? bodyObj["clientId"] : undefined,
          certificateThumbprint:
            typeof bodyObj["certificateThumbprint"] === "string"
              ? bodyObj["certificateThumbprint"]
              : undefined,
          createNew: bodyObj["createNew"] === true,
          displayName:
            typeof bodyObj["displayName"] === "string" ? bodyObj["displayName"] : undefined,
          defaultDomain:
            typeof bodyObj["defaultDomain"] === "string" ? bodyObj["defaultDomain"] : undefined,
          initialDomain:
            typeof bodyObj["initialDomain"] === "string" ? bodyObj["initialDomain"] : undefined,
          environment:
            typeof bodyObj["environment"] === "string" ? bodyObj["environment"] : "commercial",
        };

        const existing = await options.tenantStore.getTenant(tenantId, { includeDeleted: true });
        const instant = now();
        let workerResult: OnboardWorkerResult;

        try {
          workerResult = await options.runner(tenantId, input);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (options.tenantStore.appendAuditEvent) {
            const audit: TenantAuditInput = {
              id: randomUUID(),
              timestamp: instant,
              actorUserId: caller.userId ?? null,
              actorType: caller.userId ? "user" : "system",
              tenantId,
              action: "tenant.onboard",
              targetType: "tenant",
              targetId: tenantId,
              before: existing ? { status: existing.status, id: existing.id } : null,
              after: { tenantId, confirmed: true },
              result: "failure",
              error: errMsg,
              source: "request",
              correlationId: (ctx.headers["x-correlation-id"] as string) ?? null,
            };
            await options.tenantStore.appendAuditEvent(audit);
          }
          throw new AppError(ONBOARD_FAILED, `Tenant onboarding failed: ${errMsg}`, 500);
        }

        if (workerResult.status === "failed") {
          const errMsg = workerResult.error ?? "Tenant onboarding failed";
          if (options.tenantStore.appendAuditEvent) {
            const audit: TenantAuditInput = {
              id: randomUUID(),
              timestamp: instant,
              actorUserId: caller.userId ?? null,
              actorType: caller.userId ? "user" : "system",
              tenantId,
              action: "tenant.onboard",
              targetType: "tenant",
              targetId: tenantId,
              before: existing ? { status: existing.status, id: existing.id } : null,
              after: { tenantId, totalFailed: workerResult.totalFailed ?? 1 },
              result: "failure",
              error: errMsg,
              source: "request",
              correlationId: (ctx.headers["x-correlation-id"] as string) ?? null,
            };
            await options.tenantStore.appendAuditEvent(audit);
          }
          throw new AppError(ONBOARD_FAILED, errMsg, 500);
        }

        if (workerResult.status === "partial") {
          const errMsg = workerResult.error ?? "Tenant onboarding partially failed";
          if (options.tenantStore.appendAuditEvent) {
            const audit: TenantAuditInput = {
              id: randomUUID(),
              timestamp: instant,
              actorUserId: caller.userId ?? null,
              actorType: caller.userId ? "user" : "system",
              tenantId,
              action: "tenant.onboard",
              targetType: "tenant",
              targetId: tenantId,
              before: existing ? { status: existing.status, id: existing.id } : null,
              after: {
                tenantId,
                clientId: workerResult.clientId ?? null,
                thumbprint: workerResult.certificateThumbprint ?? null,
                totalFailed: workerResult.totalFailed,
              },
              result: "failure",
              error: errMsg,
              source: "request",
              correlationId: (ctx.headers["x-correlation-id"] as string) ?? null,
            };
            await options.tenantStore.appendAuditEvent(audit);
          }
          throw new AppError(ONBOARD_PARTIAL_FAILURE, errMsg, 502);
        }

        // Success path: upsert tenant row and credential reference
        const tenantRecord: TenantRecord = {
          id: tenantId,
          displayName:
            input.displayName ?? workerResult.appDisplayName ?? existing?.displayName ?? null,
          defaultDomain: input.defaultDomain ?? existing?.defaultDomain ?? null,
          initialDomain: input.initialDomain ?? existing?.initialDomain ?? null,
          source: "direct",
          status: "active",
          excluded: false,
          excludeReason: null,
          excludeDate: null,
          environment: input.environment ?? existing?.environment ?? "commercial",
          lastRunAt: existing?.lastRunAt ?? null,
          errorCount: 0,
          lastError: null,
          createdAt: existing?.createdAt ?? instant,
          updatedAt: instant,
          deletedAt: null,
        };
        const savedTenant = await options.tenantStore.upsertTenant(tenantRecord);

        if (
          options.credentialStore &&
          workerResult.clientId &&
          workerResult.certificateThumbprint
        ) {
          await options.credentialStore.upsertCredential({
            id: randomUUID(),
            tenantId,
            authMethod: "certificate-thumbprint",
            clientId: workerResult.clientId,
            secretRef: formatThumbprintRef(workerResult.certificateThumbprint),
            thumbprint: workerResult.certificateThumbprint,
            environment: input.environment ?? "commercial",
            expiresOn: null,
            lastValidated: instant,
            createdAt: instant,
            updatedAt: instant,
          });
        }

        if (options.tenantStore.appendAuditEvent) {
          const audit: TenantAuditInput = {
            id: randomUUID(),
            timestamp: instant,
            actorUserId: caller.userId ?? null,
            actorType: caller.userId ? "user" : "system",
            tenantId,
            action: "tenant.onboard",
            targetType: "tenant",
            targetId: tenantId,
            before: existing ? { status: existing.status, source: existing.source } : null,
            after: {
              tenantId,
              clientId: workerResult.clientId,
              thumbprint: workerResult.certificateThumbprint,
              appDisplayName: workerResult.appDisplayName,
              status: "active",
            },
            result: "success",
            error: null,
            source: "request",
            correlationId: (ctx.headers["x-correlation-id"] as string) ?? null,
          };
          await options.tenantStore.appendAuditEvent(audit);
        }

        return {
          status: 201,
          body: {
            tenant: savedTenant,
            onboarding: workerResult,
          },
        };
      },
    },
  ];
}

export const ONBOARD_OPENAPI = {
  paths: {
    "/v1/tenants/{id}/onboard": {
      post: {
        operationId: "onboardTenant",
        summary: "Direct tenant onboarding with app registration and consent",
        permission: ONBOARD_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["confirmed"],
                properties: {
                  confirmed: { type: "boolean" },
                  adminUpn: { type: "string" },
                  appDisplayName: { type: "string" },
                  clientId: { type: "string" },
                  certificateThumbprint: { type: "string" },
                  createNew: { type: "boolean" },
                  displayName: { type: "string" },
                  defaultDomain: { type: "string" },
                  initialDomain: { type: "string" },
                  environment: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Tenant onboarded successfully." },
          "400": { description: "Confirmation required or invalid input." },
          "401": { description: "Authentication required." },
          "403": { description: "Forbidden; tenants.onboard permission required." },
          "500": { description: "Onboarding failed." },
          "502": { description: "Partial onboarding failure." },
        },
      },
    },
  },
} as const;
