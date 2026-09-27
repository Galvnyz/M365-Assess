// Opt-in local development identity (T-0817).
//
// Portal-user token validation is EPIC-038 work that has not landed, and API-client
// authentication needs an Entra token validator that does not exist yet, so without
// this the BFF can authenticate nobody. When M365_BFF_DEV_IDENTITY is set (never in
// production; see config.ts), every request is treated as one local user with that
// EPIC-001 role across all tenants. It is off by default and the server logs loudly
// when it is on.
import type Database from "better-sqlite3";
import { ALL_TENANTS } from "../rbac/scope.js";
import type { DevIdentityRole } from "../config.js";
import type { RequestAuthenticator, RequestCaller } from "../server.js";
import type { PortalUser } from "./identity.js";

export const DEV_USER_ID = "dev-user";
export const DEV_USER_UPN = "dev-user@localhost";

/**
 * Records the dev user in portal_users. Per-user rows (dashboard layouts, for one)
 * reference that table, which real sign-in (EPIC-038) will populate on first login.
 */
export function ensureDevUser(db: Database.Database, role: DevIdentityRole): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO portal_users (id, upn, displayName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(DEV_USER_ID, DEV_USER_UPN, `Local development user (${role})`, now, now);
}

export function createDevIdentityAuthenticator(role: DevIdentityRole): RequestAuthenticator {
  const user: PortalUser & RequestCaller = Object.freeze({
    id: DEV_USER_ID,
    upn: DEV_USER_UPN,
    displayName: `Local development user (${role})`,
    roles: Object.freeze([role]),
    tenantScope: ALL_TENANTS,
  });
  return { authenticate: async () => user };
}
