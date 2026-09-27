import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8080;
export const DEFAULT_WORKER_POOL_SIZE = 2;

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type Environment = Record<string, string | undefined>;

export interface BffConfig {
  readonly host: string;
  readonly port: number;
  readonly workerPoolSize: number;
  readonly storagePath: string;
  readonly artifactPath: string;
  /**
   * Local development only: authenticate every request as this EPIC-001 role until
   * EPIC-038 delivers portal-user token validation. Null (the default) disables it.
   */
  readonly devIdentityRole: DevIdentityRole | null;
}

export type DevIdentityRole = "admin" | "operator";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const ENV = {
  host: "M365_BFF_HOST",
  port: "M365_BFF_PORT",
  workerPoolSize: "M365_BFF_WORKER_POOL_SIZE",
  storagePath: "M365_BFF_STORAGE_PATH",
  artifactPath: "M365_BFF_ARTIFACT_PATH",
  devIdentity: "M365_BFF_DEV_IDENTITY",
} as const;

function readEnv(env: Environment, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parsePort(value: string | undefined, fallback = DEFAULT_PORT): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

export function parseWorkerPoolSize(
  value: string | undefined,
  fallback = DEFAULT_WORKER_POOL_SIZE,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

/**
 * Parse the opt-in dev identity. An unknown value is an error rather than a silent
 * "off", and any value at all is refused when NODE_ENV is production.
 */
export function parseDevIdentityRole(env: Environment): DevIdentityRole | null {
  const value = readEnv(env, ENV.devIdentity);
  if (value === undefined) return null;
  if (readEnv(env, "NODE_ENV") === "production") {
    throw new ConfigError(`${ENV.devIdentity} must not be set when NODE_ENV=production`);
  }
  if (value !== "admin" && value !== "operator") {
    throw new ConfigError(`${ENV.devIdentity} must be "admin" or "operator", got "${value}"`);
  }
  return value;
}

export function loadConfig(env: Environment = process.env): BffConfig {
  const storagePath = path.resolve(
    readEnv(env, ENV.storagePath) ?? path.join(PACKAGE_ROOT, "data"),
  );
  const artifactPath = path.resolve(
    readEnv(env, ENV.artifactPath) ?? path.join(storagePath, "artifacts"),
  );
  return {
    host: readEnv(env, ENV.host) ?? DEFAULT_HOST,
    port: parsePort(readEnv(env, ENV.port)),
    workerPoolSize: parseWorkerPoolSize(readEnv(env, ENV.workerPoolSize)),
    storagePath,
    artifactPath,
    devIdentityRole: parseDevIdentityRole(env),
  };
}
