import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer as createNodeServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { AppError, ErrorCodes, normalizeError, toErrorBody } from "./errors.js";
import type { TenantScope } from "./rbac/scope.js";

export const API_PREFIX = "/v1";
export const OPENAPI_ROUTE = "/v1/openapi.yaml";

/** Largest JSON request body the server parses. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;
export const PAYLOAD_TOO_LARGE = "request.payload_too_large";
export const UNAUTHENTICATED = "auth.unauthenticated";

/**
 * Who made the request, as far as routes need to know: roles to authorize against and
 * the tenants the caller may act on. Portal users (auth/identity.ts) and API clients
 * (auth/api-client-auth.ts) both satisfy it.
 */
export interface RequestCaller {
  readonly roles: readonly string[];
  readonly tenantScope: TenantScope;
}

/** Resolves the caller from a request; null means "not mine / anonymous". */
export interface RequestAuthenticator {
  authenticate(request: IncomingMessage): Promise<RequestCaller | null>;
}

export interface RequestContext {
  readonly correlationId: string;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingMessage["headers"];
  readonly params: Readonly<Record<string, string>>;
  /** Parsed JSON request body; undefined when the request carried none. */
  readonly body?: unknown;
  /**
   * The authenticated caller, or null when anonymous. Undefined when the server was
   * built without authenticators (tests and the unauthenticated dev server).
   */
  readonly caller?: RequestCaller | null;
}

export interface RouteResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly raw?: string | Buffer;
  readonly contentType?: string;
}

export type RouteHandler = (ctx: RequestContext) => RouteResponse | Promise<RouteResponse>;

export interface Route {
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandler;
}

export interface BuildServerOptions {
  readonly routes?: readonly Route[];
  readonly openapiDocument?: string;
  /** Tried in order; the first non-null caller wins (e.g. portal users, then API clients). */
  readonly authenticators?: readonly RequestAuthenticator[];
  readonly maxBodyBytes?: number;
}

const require = createRequire(import.meta.url);

export function resolveOpenApiDocument(): string {
  const resolved = require.resolve("@m365-assess/contracts/openapi");
  return readFileSync(resolved, "utf8");
}

function matchPath(routePath: string, actualPath: string): Record<string, string> | null {
  const routeParts = routePath.split("/").filter((part) => part.length > 0);
  const actualParts = actualPath.split("/").filter((part) => part.length > 0);
  if (routeParts.length !== actualParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < routeParts.length; index += 1) {
    const routePart = routeParts[index]!;
    const actualPart = actualParts[index]!;
    if (routePart.startsWith(":")) {
      params[routePart.slice(1)] = decodeURIComponent(actualPart);
    } else if (routePart !== actualPart) {
      return null;
    }
  }
  return params;
}

function requestCorrelationId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return randomUUID();
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  correlationId: string,
): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.setHeader("X-Correlation-Id", correlationId);
  res.end(payload);
}

function sendResponse(res: ServerResponse, result: RouteResponse, correlationId: string): void {
  if (result.raw !== undefined) {
    res.statusCode = result.status;
    res.setHeader("Content-Type", result.contentType ?? "application/octet-stream");
    res.setHeader("X-Correlation-Id", correlationId);
    res.end(result.raw);
    return;
  }
  sendJson(res, result.status, result.body ?? null, correlationId);
}

/** Credential headers consumed by authenticators and never handed to routes. */
export const CREDENTIAL_HEADERS: readonly string[] = ["authorization", "x-client-secret", "cookie"];

function routeHeaders(headers: IncomingMessage["headers"]): IncomingMessage["headers"] {
  const copy = { ...headers };
  for (const name of CREDENTIAL_HEADERS) delete copy[name];
  return copy;
}

function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false;
  const type = header.split(";")[0]!.trim().toLowerCase();
  return type === "application/json" || (type.startsWith("application/") && type.endsWith("+json"));
}

function payloadTooLarge(limit: number): AppError {
  return new AppError(PAYLOAD_TOO_LARGE, `request body exceeds ${limit} bytes`, 413);
}

/** Read and parse a JSON body. Non-JSON or empty bodies yield undefined. */
async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!isJsonContentType(req.headers["content-type"])) return undefined;
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw payloadTooLarge(limit);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.length;
    if (size > limit) throw payloadTooLarge(limit);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(ErrorCodes.validationFailed, "Request body is not valid JSON", 400, [
      { field: "body", reason: "must be valid JSON" },
    ]);
  }
}

/**
 * Resolve the caller. Any authenticator failure is a 401: a bad or unverifiable
 * credential must never surface as a server error, and the credential itself is
 * never logged or attached to the context.
 */
async function resolveCaller(
  req: IncomingMessage,
  authenticators: readonly RequestAuthenticator[] | undefined,
): Promise<RequestCaller | null | undefined> {
  if (authenticators === undefined) return undefined;
  for (const authenticator of authenticators) {
    let caller: RequestCaller | null;
    try {
      caller = await authenticator.authenticate(req);
    } catch (error) {
      if (error instanceof AppError && error.status === 401) throw error;
      throw new AppError(UNAUTHENTICATED, "authentication failed", 401);
    }
    if (caller !== null) return caller;
  }
  return null;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routes: readonly Route[],
  options: BuildServerOptions,
): Promise<void> {
  const correlationId = requestCorrelationId(req.headers["x-correlation-id"]);
  try {
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    for (const route of routes) {
      if (route.method.toUpperCase() !== method) {
        continue;
      }
      const params = matchPath(route.path, url.pathname);
      if (params === null) {
        continue;
      }
      const caller = await resolveCaller(req, options.authenticators);
      const body = await readJsonBody(req, options.maxBodyBytes ?? MAX_JSON_BODY_BYTES);
      const result = await route.handler({
        correlationId,
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: routeHeaders(req.headers),
        params,
        ...(body !== undefined ? { body } : {}),
        ...(caller !== undefined ? { caller } : {}),
      });
      sendResponse(res, result, correlationId);
      return;
    }
    throw new AppError(
      ErrorCodes.routeNotFound,
      `No route for ${method} ${url.pathname}`,
      404,
    );
  } catch (error) {
    const appError = normalizeError(error);
    if (appError.code === ErrorCodes.internalError) {
      console.error(`[${correlationId}]`, error);
    }
    sendJson(res, appError.status, toErrorBody(appError, correlationId), correlationId);
  }
}

export function buildServer(options: BuildServerOptions = {}): Server {
  const routes: Route[] = [
    {
      method: "GET",
      path: OPENAPI_ROUTE,
      handler: () => ({
        status: 200,
        raw: options.openapiDocument ?? resolveOpenApiDocument(),
        contentType: "application/yaml; charset=utf-8",
      }),
    },
    ...(options.routes ?? []),
  ];

  return createNodeServer((req, res) => {
    void handleRequest(req, res, routes, options);
  });
}
