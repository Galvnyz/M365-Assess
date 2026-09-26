import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { JitRepository } from "../../../db/src/jit-repository.js";
import type {
  JitGrant,
  JitGrantInput,
  JitGrantState,
  JitGrantUpdate,
} from "../../../db/src/repository.js";
import {
  JIT_DURATION_EXCEEDED,
  JIT_GRANTS_PATH,
  JIT_GRANT_EXTEND_PATH,
  JIT_GRANT_REVOKE_PATH,
  ROLES_READ_PERMISSION,
  ROLES_WRITE_PERMISSION,
  createJitGrantsRoutes,
  type JitAuditEvent,
  type JitGrantExecutionProvider,
} from "./jit-grants.js";

const TENANT = "tenant-a";

class InMemoryJitRepository implements JitRepository {
  readonly schemaVersion = 74;
  private readonly store = new Map<string, JitGrant>();

  close(): void {}

  async createGrant(input: JitGrantInput): Promise<JitGrant> {
    const now = new Date().toISOString();
    const item: JitGrant = {
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      roleId: input.roleId,
      templateId: input.templateId ?? null,
      assignmentType: input.assignmentType,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      durationHours: input.durationHours,
      maxDurationHours: input.maxDurationHours,
      state: input.state,
      justification: input.justification ?? null,
      createdBy: input.createdBy,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      revokedAt: null,
      revokedBy: null,
    };
    this.store.set(item.id, item);
    return item;
  }

  async getGrant(tenantId: string, id: string): Promise<JitGrant | undefined> {
    const item = this.store.get(id);
    return item?.tenantId === tenantId ? item : undefined;
  }

  async getGrantById(id: string): Promise<JitGrant | undefined> {
    return this.store.get(id);
  }

  async listGrants(
    tenantId: string,
    filter?: { userId?: string; state?: JitGrantState },
  ): Promise<JitGrant[]> {
    return Array.from(this.store.values()).filter((item) => {
      if (item.tenantId !== tenantId) return false;
      if (filter?.userId && item.userId !== filter.userId) return false;
      if (filter?.state && item.state !== filter.state) return false;
      return true;
    });
  }

  async updateGrant(id: string, update: JitGrantUpdate): Promise<JitGrant | undefined> {
    const existing = await this.getGrantById(id);
    if (!existing) return undefined;
    const updated: JitGrant = {
      ...existing,
      state: update.state ?? existing.state,
      endsAt: update.endsAt ?? existing.endsAt,
      durationHours: update.durationHours ?? existing.durationHours,
      revokedAt: update.revokedAt !== undefined ? update.revokedAt : existing.revokedAt,
      revokedBy: update.revokedBy !== undefined ? update.revokedBy : existing.revokedBy,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }
}

class FakeJitExecutionProvider implements JitGrantExecutionProvider {
  readonly granted: Array<{ tenantId: string; grant: JitGrant }> = [];
  readonly revoked: Array<{ tenantId: string; grant: JitGrant }> = [];
  readonly extended: Array<{ tenantId: string; grant: JitGrant; newEndsAt: string }> = [];

  async grantRole(tenantId: string, grant: JitGrant): Promise<{ grantId: string; startsAt: string; endsAt: string }> {
    this.granted.push({ tenantId, grant });
    return { grantId: grant.id, startsAt: grant.startsAt, endsAt: grant.endsAt };
  }

  async revokeRole(tenantId: string, grant: JitGrant): Promise<void> {
    this.revoked.push({ tenantId, grant });
  }

  async extendRole(tenantId: string, grant: JitGrant, newEndsAt: string): Promise<void> {
    this.extended.push({ tenantId, grant, newEndsAt });
  }
}

describe("JIT admin grants (T-0246)", () => {
  it("creates a bounded, audited JIT grant with startsAt and endsAt", async () => {
    const repo = new InMemoryJitRepository();
    const execution = new FakeJitExecutionProvider();
    const audits: JitAuditEvent[] = [];

    const routes = createJitGrantsRoutes({
      repository: repo,
      executionProvider: execution,
      recordAudit: async (ev) => {
        audits.push(ev);
      },
      resolveCaller: () => ({
        userId: "admin-user",
        tenantScope: tenantScope([TENANT]),
        permissions: [ROLES_WRITE_PERMISSION],
      }),
    });

    const createRoute = routes.find((r) => r.method === "POST" && r.path === JIT_GRANTS_PATH)!;

    const resp = await createRoute.handler({
      method: "POST",
      path: `/v1/tenants/${TENANT}/jit-grants`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
      body: {
        userId: "user-alice",
        roleId: "role-ga",
        durationHours: 6,
        maxDurationHours: 12,
        justification: "Deploying production hotfix",
      },
    });

    expect(resp.status).toBe(201);
    const body = resp.body as JitGrant;
    expect(body.state).toBe("active");
    expect(body.durationHours).toBe(6);
    expect(body.startsAt).not.toBeNull();
    expect(body.endsAt).not.toBeNull();
    expect(body.createdBy).toBe("admin-user");

    expect(execution.granted).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("jit.grant");
    expect(audits[0]?.result).toBe("success");
  });

  it("rejects grant if duration exceeds maxDurationHours", async () => {
    const repo = new InMemoryJitRepository();
    const routes = createJitGrantsRoutes({
      repository: repo,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: [ROLES_WRITE_PERMISSION],
      }),
    });

    const createRoute = routes.find((r) => r.method === "POST" && r.path === JIT_GRANTS_PATH)!;

    await expect(
      createRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/jit-grants`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
        body: {
          userId: "user-alice",
          roleId: "role-ga",
          durationHours: 36,
          maxDurationHours: 24,
        },
      }),
    ).rejects.toMatchObject({
      code: JIT_DURATION_EXCEEDED,
      status: 400,
    });
  });

  it("revokes a grant early and audits revocation", async () => {
    const repo = new InMemoryJitRepository();
    const existing = await repo.createGrant({
      id: "grant-rev-1",
      tenantId: TENANT,
      userId: "user-bob",
      roleId: "role-sa",
      assignmentType: "eligible",
      startsAt: "2026-09-26T12:00:00Z",
      endsAt: "2026-09-26T20:00:00Z",
      durationHours: 8,
      maxDurationHours: 24,
      state: "active",
      createdBy: "admin-1",
    });

    const execution = new FakeJitExecutionProvider();
    const audits: JitAuditEvent[] = [];

    const routes = createJitGrantsRoutes({
      repository: repo,
      executionProvider: execution,
      recordAudit: async (ev) => {
        audits.push(ev);
      },
      resolveCaller: () => ({
        userId: "admin-revoker",
        tenantScope: tenantScope([TENANT]),
        permissions: [ROLES_WRITE_PERMISSION],
      }),
    });

    const revokeRoute = routes.find(
      (r) => r.method === "POST" && r.path === JIT_GRANT_REVOKE_PATH,
    )!;

    const resp = await revokeRoute.handler({
      method: "POST",
      path: "/v1/jit-grants/grant-rev-1/revoke",
      params: { id: "grant-rev-1" },
      query: new URLSearchParams(),
      headers: {},
    });

    expect(resp.status).toBe(200);
    const body = resp.body as JitGrant;
    expect(body.state).toBe("revoked");
    expect(body.revokedAt).not.toBeNull();
    expect(body.revokedBy).toBe("admin-revoker");

    expect(execution.revoked).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("jit.revoke");
  });

  it("extends a grant window within maximum duration", async () => {
    const repo = new InMemoryJitRepository();
    await repo.createGrant({
      id: "grant-ext-1",
      tenantId: TENANT,
      userId: "user-charlie",
      roleId: "role-ga",
      assignmentType: "active",
      startsAt: "2026-09-26T12:00:00Z",
      endsAt: "2026-09-26T16:00:00Z",
      durationHours: 4,
      maxDurationHours: 12,
      state: "active",
      createdBy: "admin-1",
    });

    const routes = createJitGrantsRoutes({
      repository: repo,
      resolveCaller: () => ({
        userId: "admin-extender",
        tenantScope: tenantScope([TENANT]),
        permissions: [ROLES_WRITE_PERMISSION],
      }),
    });

    const extendRoute = routes.find(
      (r) => r.method === "POST" && r.path === JIT_GRANT_EXTEND_PATH,
    )!;

    const resp = await extendRoute.handler({
      method: "POST",
      path: "/v1/jit-grants/grant-ext-1/extend",
      params: { id: "grant-ext-1" },
      query: new URLSearchParams(),
      headers: {},
      body: {
        additionalHours: 4,
      },
    });

    expect(resp.status).toBe(200);
    const body = resp.body as JitGrant;
    expect(body.state).toBe("extended");
    expect(body.durationHours).toBe(8);

    // Rejecting when exceeding max duration
    await expect(
      extendRoute.handler({
        method: "POST",
        path: "/v1/jit-grants/grant-ext-1/extend",
        params: { id: "grant-ext-1" },
        query: new URLSearchParams(),
        headers: {},
        body: {
          additionalHours: 10, // 8 + 10 = 18 > 12
        },
      }),
    ).rejects.toMatchObject({
      code: JIT_DURATION_EXCEEDED,
      status: 400,
    });
  });
});
