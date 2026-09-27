// Test-connection endpoint (EPIC-002 SPEC.md §4.1 step 5, §4.2 step 3, §6, §10).
// POST /v1/tenants/{id}/test-connection runs a live, read-only connect check
// and returns per-service pass/fail status without writing tenant configuration.
// A successful test records `lastValidated` and resets the tenant error count.
// A failed test increments the tenant error state (and flips to 'error' at threshold).
// Secret material is never handled or logged in the BFF; only references are passed.

import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route } from "../server.js";
import type { TenantAuditInput, TenantRecord, TenantStore } from "./tenants.js";
import type { CredentialRecord, CredentialStoreRow } from "./credentials.js";

export const TEST_CONNECTION_PATH = "/v1/tenants/:id/test-connection";
export const TEST_CONNECTION_PERMISSION = "Tenant.Administration.Read";

export const TENANT_NOT_FOUND = "tenant.not_found";
export const CREDENTIAL_NOT_FOUND = "credential.not_found";
export const TEST_CONNECTION_UNAUTHENTICATED = "request.unauthenticated";

export const DEFAULT_ERROR_THRESHOLD = 3;

export interface ServiceConnectionResult {
  readonly service: string;
  readonly status: "pass" | "fail";
  readonly connected: boolean;
  readonly error?: string | null;
}

export interface TestConnectionResult {
  readonly tenantId: string;
  readonly success: boolean;
  readonly testedAt: string;
  readonly services: readonly ServiceConnectionResult[];
}

export type TestConnectionRunner = (
  tenantId: string,
  credential?: CredentialRecord,
) => Promise<TestConnectionResult>;

export interface TestConnectionCaller extends Caller {
  readonly userId?: string;
}

export type TestConnectionAuthorizer = (
  caller: TestConnectionCaller,
  permission: string,
) => void | Promise<void>;

export interface TestConnectionRouteOptions {
  readonly tenantStore: TenantStore;
  readonly credentialStore?: CredentialStoreRow;
  readonly runner: TestConnectionRunner;
  readonly resolveCaller: (ctx: RequestContext) => TestConnectionCaller | undefined;
  readonly authorize?: TestConnectionAuthorizer;
  readonly now?: () => string;
  readonly errorThreshold?: number;
}

function unauthenticatedError(): AppError {
  return new AppError(TEST_CONNECTION_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => TestConnectionCaller | undefined,
  ctx: RequestContext,
): TestConnectionCaller {
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

export function createTestConnectionRoutes(options: TestConnectionRouteOptions): Route[] {
  const now = options.now ?? (() => new Date().toISOString());
  const errorThreshold = options.errorThreshold ?? DEFAULT_ERROR_THRESHOLD;
  const authorize: TestConnectionAuthorizer =
    options.authorize ??
    ((caller, perm) => {
      if (!caller.roles.includes("admin") && !caller.roles.includes("operator")) {
        throw new AppError("rbac.forbidden", `permission ${perm} required`, 403);
      }
    });

  return [
    {
      method: "POST",
      path: TEST_CONNECTION_PATH,
      handler: async (ctx: RequestContext) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = extractTenantId(ctx);
        requireTenantInScope(caller, tenantId);
        await authorize(caller, TEST_CONNECTION_PERMISSION);

        const tenant = await options.tenantStore.getTenant(tenantId);
        if (tenant === undefined || tenant.deletedAt !== null) {
          throw new AppError(TENANT_NOT_FOUND, `tenant ${tenantId} was not found`, 404);
        }

        let credential: CredentialRecord | undefined;
        if (options.credentialStore) {
          credential = await options.credentialStore.getCredential(tenantId);
          if (credential === undefined) {
            throw new AppError(
              CREDENTIAL_NOT_FOUND,
              `tenant ${tenantId} has no credential configured`,
              404,
            );
          }
        }

        const result = await options.runner(tenantId, credential);
        const instant = now();

        if (result.success) {
          // Record lastValidated on success
          if (credential && options.credentialStore) {
            await options.credentialStore.upsertCredential({
              ...credential,
              lastValidated: result.testedAt || instant,
              updatedAt: instant,
            });
          }

          // Reset tenant error count on connect success without modifying tenant configuration
          const updatedTenant: TenantRecord = {
            ...tenant,
            errorCount: 0,
            lastError: null,
            status: tenant.excluded ? "excluded" : "active",
            updatedAt: instant,
          };
          await options.tenantStore.upsertTenant(updatedTenant);

          if (options.tenantStore.appendAuditEvent) {
            const audit: TenantAuditInput = {
              id: randomUUID(),
              timestamp: instant,
              actorUserId: caller.userId ?? null,
              actorType: caller.userId ? "user" : "system",
              tenantId,
              action: "tenant.test-connection",
              targetType: "tenant",
              targetId: tenantId,
              before: { status: tenant.status, errorCount: tenant.errorCount },
              after: { status: updatedTenant.status, errorCount: updatedTenant.errorCount, success: true },
              result: "success",
              error: null,
              source: "request",
              correlationId: (ctx.headers["x-correlation-id"] as string) ?? null,
            };
            await options.tenantStore.appendAuditEvent(audit);
          }
        } else {
          // Increment tenant error count on failure without modifying tenant configuration
          const firstFail = result.services.find((s) => s.status === "fail" || !s.connected);
          const failureReason = firstFail?.error ?? "connection test failed";
          const newErrorCount = tenant.errorCount + 1;
          const newStatus =
            newErrorCount >= errorThreshold && !tenant.excluded ? "error" : tenant.status;

          const updatedTenant: TenantRecord = {
            ...tenant,
            errorCount: newErrorCount,
            lastError: failureReason,
            status: newStatus,
            updatedAt: instant,
          };
          await options.tenantStore.upsertTenant(updatedTenant);

          if (options.tenantStore.appendAuditEvent) {
            const audit: TenantAuditInput = {
              id: randomUUID(),
              timestamp: instant,
              actorUserId: caller.userId ?? null,
              actorType: caller.userId ? "user" : "system",
              tenantId,
              action: "tenant.test-connection",
              targetType: "tenant",
              targetId: tenantId,
              before: { status: tenant.status, errorCount: tenant.errorCount },
              after: { status: updatedTenant.status, errorCount: updatedTenant.errorCount, success: false },
              result: "failure",
              error: failureReason,
              source: "request",
              correlationId: (ctx.headers["x-correlation-id"] as string) ?? null,
            };
            await options.tenantStore.appendAuditEvent(audit);
          }
        }

        return {
          status: 200,
          body: result,
        };
      },
    },
  ];
}

export const TEST_CONNECTION_OPENAPI = {
  paths: {
    "/v1/tenants/{id}/test-connection": {
      post: {
        operationId: "testTenantConnection",
        summary: "Test live connectivity to Microsoft cloud services for a tenant",
        permission: TEST_CONNECTION_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Connection test result with per-service status.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TestConnectionResult" },
              },
            },
          },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside caller scope." },
          "404": { description: "Tenant or credential not found." },
        },
      },
    },
  },
  schemas: {
    ServiceConnectionResult: {
      type: "object",
      required: ["service", "status", "connected"],
      properties: {
        service: { type: "string" },
        status: { type: "string", enum: ["pass", "fail"] },
        connected: { type: "boolean" },
        error: { type: ["string", "null"] },
      },
    },
    TestConnectionResult: {
      type: "object",
      required: ["tenantId", "success", "testedAt", "services"],
      properties: {
        tenantId: { type: "string" },
        success: { type: "boolean" },
        testedAt: { type: "string", format: "date-time" },
        services: {
          type: "array",
          items: { $ref: "#/components/schemas/ServiceConnectionResult" },
        },
      },
    },
  },
} as const;
