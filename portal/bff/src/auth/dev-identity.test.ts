import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseDevIdentityRole } from "../config.js";
import { ALL_TENANTS } from "../rbac/scope.js";
import { DEV_USER_ID, createDevIdentityAuthenticator } from "./dev-identity.js";

describe("dev identity (T-0817)", () => {
  it("is off unless explicitly configured", () => {
    expect(parseDevIdentityRole({})).toBeNull();
    expect(loadConfig({}).devIdentityRole).toBeNull();
  });

  it("accepts admin or operator", () => {
    expect(parseDevIdentityRole({ M365_BFF_DEV_IDENTITY: "admin" })).toBe("admin");
    expect(loadConfig({ M365_BFF_DEV_IDENTITY: " operator " }).devIdentityRole).toBe("operator");
  });

  it("rejects unknown roles instead of silently disabling", () => {
    expect(() => parseDevIdentityRole({ M365_BFF_DEV_IDENTITY: "superadmin" })).toThrow(ConfigError);
  });

  it("is refused in production", () => {
    expect(() => parseDevIdentityRole({ M365_BFF_DEV_IDENTITY: "admin", NODE_ENV: "production" })).toThrow(
      /must not be set when NODE_ENV=production/,
    );
    expect(parseDevIdentityRole({ NODE_ENV: "production" })).toBeNull();
  });

  it("authenticates every request as the configured role across all tenants", async () => {
    const caller = await createDevIdentityAuthenticator("operator").authenticate({} as IncomingMessage);
    expect(caller).toMatchObject({ id: DEV_USER_ID, roles: ["operator"], tenantScope: ALL_TENANTS });
  });
});
