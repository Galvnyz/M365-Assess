// Tenant credential set/rotate (EPIC-002 SPEC.md §6 `POST /v1/tenants/{id}/credential`).
// The database row keeps a `secretRef` reference only (03-database.md §4); secret
// material goes to the `CredentialStore` backend and is never returned, logged,
// or written to audit payloads. Certificate auth is preferred: a client secret
// is accepted for Graph-only use but refused up front when the caller targets
// Exchange Online or Purview, mirroring the worker-side
// `Resolve-TenantCredential` compatibility check (T-0011) so the failure is
// stable and never depends on per-service connect loops. Every mutation appends
// an AuditEvent; `CIPP.Admin.TenantCredentials` is admin-only (SPEC.md §7).
import { randomUUID } from "node:crypto";
import { deriveCredentialState, type CredentialState } from "../credentials/expiry.js";
import {
  formatSecretRef,
  formatThumbprintRef,
  type CredentialStore,
} from "../credentials/store.js";
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route } from "../server.js";

export const TENANT_CREDENTIAL_PATH = "/v1/tenants/:id/credential";

export const CREDENTIALS_PERMISSION = "CIPP.Admin.TenantCredentials";

export const CREDENTIAL_NOT_FOUND = "credential.not_found";
export const CREDENTIAL_UNSUPPORTED = "credential.unsupported";

export const CREDENTIAL_UNAUTHENTICATED = "request.unauthenticated";

export type CredentialAuthMethod =
  | "certificate"
  | "certificate-thumbprint"
  | "certificate-pfx"
  | "client-secret";

export interface CredentialRecord {
  id: string;
  tenantId: string;
  authMethod: string;
  clientId: string;
  secretRef: string;
  thumbprint: string | null;
  environment: string;
  expiresOn: string | null;
  lastValidated: string | null;
  createdAt: string;
  updatedAt: string;
}

// The only shape a response or audit payload may carry: the row minus any
// material, plus the derived expiry state. There is deliberately no field that
// could hold a secret value.
export interface CredentialView {
  tenantId: string;
  authMethod: string;
  clientId: string;
  secretRef: string;
  thumbprint: string | null;
  environment: string;
  expiresOn: string | null;
  lastValidated: string | null;
  state: CredentialState;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialAuditInput {
  id: string;
  timestamp: string;
  actorUserId: string | null;
  actorType: "user" | "apiClient" | "system";
  tenantId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  result: "success" | "failure";
  error: string | null;
  source: "request" | "schedule" | "remediation";
  correlationId: string | null;
}

export interface CredentialStoreRow {
  getCredential(tenantId: string): Promise<CredentialRecord | undefined>;
  upsertCredential(input: CredentialRecord): Promise<CredentialRecord>;
  appendAuditEvent(input: CredentialAuditInput): Promise<unknown>;
}

export interface CredentialCaller extends Caller {
  readonly userId?: string;
}

export type CredentialAuthorizer = (
  caller: CredentialCaller,
  permission: string,
) => void | Promise<void>;

export interface CredentialRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface CredentialRouteOptions {
  readonly records: CredentialStoreRow;
  readonly secrets: CredentialStore;
  readonly resolveCaller: (ctx: RequestContext) => CredentialCaller | undefined;
  readonly authorize?: CredentialAuthorizer;
  readonly readBody?: (ctx: CredentialRequestContext) => unknown;
  readonly now?: () => string;
}

type JsonObject = Record<string, unknown>;

const AUTH_METHODS: readonly string[] = [
  "certificate",
  "certificate-thumbprint",
  "certificate-pfx",
  "client-secret",
];

const ENVIRONMENTS: readonly string[] = ["commercial", "gcc", "gcchigh", "dod"];

// Assessment sections whose services reject client-secret auth, repeated from
// `Resolve-TenantCredential` (T-0011): Exchange Online and Purview SDKs do not
// accept secrets (see Connect-Service.ps1).
const SECRET_BLOCKED_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  Email: ["ExchangeOnline"],
  Security: ["ExchangeOnline", "Purview"],
  Inventory: ["ExchangeOnline"],
  SOC2: ["Purview"],
};

function validationError(message: string, field?: string): AppError {
  return new AppError(
    ErrorCodes.validationFailed,
    message,
    400,
    field === undefined ? undefined : [{ field, reason: "invalid" }],
  );
}

function unauthenticatedError(): AppError {
  return new AppError(CREDENTIAL_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => CredentialCaller | undefined,
  ctx: RequestContext,
): CredentialCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function readJsonObject(
  ctx: CredentialRequestContext,
  readBody: (ctx: CredentialRequestContext) => unknown,
): JsonObject {
  let body = readBody(ctx);
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw validationError("request body is not valid JSON", "body");
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationError("request body must be a JSON object", "body");
  }
  return body as JsonObject;
}

function requireTenantId(ctx: RequestContext): string {
  const id = ctx.params["id"];
  if (id === undefined || id.trim().length === 0) {
    throw new AppError(CREDENTIAL_NOT_FOUND, "tenant credential was not found", 404);
  }
  return id;
}

function parseAuthMethod(value: unknown): CredentialAuthMethod {
  if (typeof value !== "string") {
    throw validationError("authMethod must be a string", "authMethod");
  }
  const normalized = value.trim().toLowerCase();
  if (!(AUTH_METHODS as readonly string[]).includes(normalized)) {
    throw validationError(
      "authMethod must be 'certificate', 'certificate-thumbprint', 'certificate-pfx', or 'client-secret'",
      "authMethod",
    );
  }
  return normalized as CredentialAuthMethod;
}

function parseClientId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("clientId must be a non-empty string", "clientId");
  }
  return value.trim();
}

function parseOptionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw validationError(`${field} must be a string`, field);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseEnvironment(value: unknown): string {
  if (value === undefined || value === null) {
    return "commercial";
  }
  if (typeof value !== "string" || !ENVIRONMENTS.includes(value.trim().toLowerCase())) {
    throw validationError(
      "environment must be 'commercial', 'gcc', 'gcchigh', or 'dod'",
      "environment",
    );
  }
  return value.trim().toLowerCase();
}

function parseExpiresOn(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw validationError("expiresOn must be a valid date-time string", "expiresOn");
  }
  return value;
}

function parseSections(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw validationError("sections must be an array of strings", "sections");
  }
  return value as string[];
}

function assertSecretSupported(sections: readonly string[]): void {
  const offenders = [...new Set(sections.filter((section) => section in SECRET_BLOCKED_SECTIONS))];
  if (offenders.length > 0) {
    throw new AppError(
      CREDENTIAL_UNSUPPORTED,
      `client-secret auth is not supported by Exchange Online or Purview (sections: ${offenders.join(", ")}). Use certificate auth for these sections.`,
      400,
    );
  }
}

function toView(record: CredentialRecord): CredentialView {
  return {
    tenantId: record.tenantId,
    authMethod: record.authMethod,
    clientId: record.clientId,
    secretRef: record.secretRef,
    thumbprint: record.thumbprint,
    environment: record.environment,
    expiresOn: record.expiresOn,
    lastValidated: record.lastValidated,
    state: deriveCredentialState(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function snapshot(record: CredentialRecord): Record<string, unknown> {
  return { ...toView(record) };
}

export function createCredentialRoutes(options: CredentialRouteOptions): Route[] {
  const readBody = options.readBody ?? ((ctx) => ctx.body);
  const now = options.now ?? (() => new Date().toISOString());

  const handler =
    (
      fn: (ctx: CredentialRequestContext) => Promise<{ status: number; body?: unknown }>,
    ): Route["handler"] =>
    (ctx) =>
      fn(ctx as CredentialRequestContext);

  return [
    {
      method: "POST",
      path: TENANT_CREDENTIAL_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        if (options.authorize) {
          await options.authorize(caller, CREDENTIALS_PERMISSION);
        }
        const tenantId = requireTenantId(ctx);
        requireTenantInScope(caller, tenantId);
        const body = readJsonObject(ctx, readBody);
        const authMethod = parseAuthMethod(body["authMethod"]);
        const clientId = parseClientId(body["clientId"]);
        const environment = parseEnvironment(body["environment"]);
        const expiresOn = parseExpiresOn(body["expiresOn"]);

        let secretRef: string;
        let thumbprint: string | null = null;
        if (authMethod === "certificate" || authMethod === "certificate-thumbprint") {
          thumbprint = parseOptionalText(body["thumbprint"], "thumbprint");
          if (thumbprint === null) {
            throw validationError("thumbprint is required for certificate auth", "thumbprint");
          }
          secretRef = formatThumbprintRef(thumbprint);
        } else if (authMethod === "certificate-pfx") {
          const certificatePath = parseOptionalText(body["certificatePath"], "certificatePath");
          if (certificatePath === null) {
            throw validationError(
              "certificatePath is required for certificate-pfx auth",
              "certificatePath",
            );
          }
          const certificatePassword = parseOptionalText(
            body["certificatePassword"],
            "certificatePassword",
          );
          secretRef = formatSecretRef(tenantId);
          await options.secrets.writeSecret(
            secretRef,
            JSON.stringify({
              certificatePath,
              ...(certificatePassword === null ? {} : { certificatePassword }),
            }),
          );
        } else {
          const clientSecret = parseOptionalText(body["clientSecret"], "clientSecret");
          if (clientSecret === null) {
            throw validationError(
              "clientSecret is required for client-secret auth",
              "clientSecret",
            );
          }
          assertSecretSupported(parseSections(body["sections"]));
          secretRef = formatSecretRef(tenantId);
          await options.secrets.writeSecret(secretRef, clientSecret);
        }

        const prior = await options.records.getCredential(tenantId);
        const instant = now();
        const stored = await options.records.upsertCredential({
          id: prior?.id ?? randomUUID(),
          tenantId,
          authMethod,
          clientId,
          secretRef,
          thumbprint,
          environment,
          expiresOn,
          lastValidated: null,
          createdAt: prior?.createdAt ?? instant,
          updatedAt: instant,
        });
        if (prior !== undefined && prior.secretRef !== stored.secretRef) {
          await options.secrets.deleteSecret(prior.secretRef).catch(() => undefined);
        }
        await options.records.appendAuditEvent({
          id: randomUUID(),
          timestamp: instant,
          actorUserId: caller.userId ?? null,
          actorType: "user",
          tenantId,
          action: prior === undefined ? "tenant.credential.set" : "tenant.credential.rotate",
          targetType: "tenant-credential",
          targetId: tenantId,
          before: prior === undefined ? null : snapshot(prior),
          after: snapshot(stored),
          result: "success",
          error: null,
          source: "request",
          correlationId: ctx.correlationId,
        });
        return { status: prior === undefined ? 201 : 200, body: toView(stored) };
      }),
    },
  ];
}

export const CREDENTIALS_OPENAPI = {
  paths: {
    "/tenants/{id}/credential": {
      post: {
        operationId: "setTenantCredential",
        summary: "Set or rotate a tenant credential; stores a secret reference only",
        permission: CREDENTIALS_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantCredentialSet" },
            },
          },
        },
        responses: {
          "200": { description: "The rotated credential reference; no secret value." },
          "201": { description: "The new credential reference; no secret value." },
          "400": { description: "Validation failed, or a client secret was supplied for Exchange Online/Purview sections." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope, or the caller lacks tenants.credentials." },
        },
      },
    },
  },
  schemas: {
    TenantCredentialSet: {
      type: "object",
      required: ["authMethod", "clientId"],
      additionalProperties: false,
      properties: {
        authMethod: {
          type: "string",
          enum: ["certificate", "certificate-thumbprint", "certificate-pfx", "client-secret"],
        },
        clientId: { type: "string" },
        thumbprint: { type: ["string", "null"] },
        clientSecret: { type: ["string", "null"] },
        certificatePath: { type: ["string", "null"] },
        certificatePassword: { type: ["string", "null"] },
        environment: { type: "string", enum: ["commercial", "gcc", "gcchigh", "dod"] },
        expiresOn: { type: ["string", "null"], format: "date-time" },
        sections: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;
