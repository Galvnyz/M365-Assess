// EPIC-002 storage adapters (T-0822): the tenant-area route stores implemented on the
// @m365-assess/db repositories. Shapes already match field for field (the routes were
// written against the db contract), so these only rename methods and assemble the
// group-filter candidates. No domain logic lives here (ADR-0014 thin BFF).
import type { SqliteRepository } from "@m365-assess/db";
import type { FilterTenantSnapshot } from "../domain/tenant-group-filter.js";
import type { CredentialStoreRow } from "../routes/credentials.js";
import type { TenantGroupStore } from "../routes/tenant-groups.js";
import type { TenantVariableStore } from "../routes/tenant-variables.js";
import type { TenantStore } from "../routes/tenants.js";
import type { GdapRelationshipStore } from "../tenants/gdap-tenant-source.js";

export function createTenantStore(repo: SqliteRepository): TenantStore {
  return {
    listTenants: (options) => repo.listTenants(options),
    getTenant: (tenantId, options) => repo.getTenant(tenantId, options),
    upsertTenant: (input) => repo.upsertTenant(input),
    softDeleteTenant: (tenantId, options) => repo.softDeleteTenant(tenantId, options),
    appendAuditEvent: (input) => repo.appendAuditEvent(input),
  };
}

/**
 * Group-filter candidates: every live tenant with its non-secret variables. No table
 * records which SKUs a tenant holds (license_pricing is price overrides, not inventory),
 * so `skus` is empty and SKU-filtered groups resolve to no tenants until a license
 * inventory exists (T-0828).
 */
async function listFilterCandidates(repo: SqliteRepository): Promise<FilterTenantSnapshot[]> {
  const [tenants, variables] = await Promise.all([
    repo.listTenants(),
    repo.listTenantVariables({ includeGlobal: false }),
  ]);
  return tenants.map((tenant) => {
    const vars: Record<string, string> = {};
    for (const v of variables) {
      if (v.tenantId === tenant.id && !v.isSecret) vars[v.name] = v.value;
    }
    return { id: tenant.id, skus: [], variables: vars };
  });
}

export function createTenantGroupStore(repo: SqliteRepository): TenantGroupStore {
  return {
    listGroups: (options) => repo.listTenantGroups(options),
    getGroup: (groupId, options) => repo.getTenantGroup(groupId, options),
    upsertGroup: (input) => repo.upsertTenantGroup(input),
    softDeleteGroup: (groupId, options) => repo.softDeleteTenantGroup(groupId, options),
    listMembers: (groupId) => repo.listTenantGroupMembers(groupId),
    addMember: (input) => repo.addTenantGroupMember(input),
    removeMember: (groupId, tenantId) => repo.removeTenantGroupMember(groupId, tenantId),
    listCandidates: () => listFilterCandidates(repo),
    appendAuditEvent: (input) => repo.appendAuditEvent(input),
  };
}

export function createTenantVariableStore(repo: SqliteRepository): TenantVariableStore {
  return {
    getVariable: (variableId) => repo.getTenantVariable(variableId),
    listVariables: () => repo.listTenantVariables(),
    upsertVariable: (input) => repo.upsertTenantVariable(input),
    deleteVariable: (variableId) => repo.deleteTenantVariable(variableId),
    appendAuditEvent: (input) => repo.appendAuditEvent(input),
  };
}

export function createCredentialRowStore(repo: SqliteRepository): CredentialStoreRow {
  return {
    getCredential: (tenantId) => repo.getTenantCredential(tenantId),
    upsertCredential: (input) => repo.upsertTenantCredential(input),
    appendAuditEvent: (input) => repo.appendAuditEvent(input),
  };
}

export function createGdapRelationshipStore(repo: SqliteRepository): GdapRelationshipStore {
  return {
    getGdapRelationship: (tenantId) => repo.getGdapRelationship(tenantId),
    listGdapRelationships: () => repo.listGdapRelationships(),
    // The route's optional fields default to null, as the db row requires.
    upsertGdapRelationship: (input) =>
      repo.upsertGdapRelationship({
        tenantId: input.tenantId,
        relationshipEnd: input.relationshipEnd ?? null,
        delegatedPrivilegeStatus: input.delegatedPrivilegeStatus ?? null,
        cpvConsentState: input.cpvConsentState ?? null,
        lastSynced: input.lastSynced ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      }),
  };
}
