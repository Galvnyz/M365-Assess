import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import {
  InMemoryGroupTemplateRepository,
  SqliteGroupTemplateRepository,
  type GroupTemplateCreateInput,
} from "../repository/group-templates.js";
import {
  GROUP_TEMPLATES_PATH,
  GROUP_TEMPLATES_PERMISSION,
  createGroupTemplatesRoutes,
  type GroupTemplatesCaller,
} from "./group-templates.js";

const VALID_INPUT: GroupTemplateCreateInput = {
  name: "Department Standard Team",
  groupType: "m365",
  naming: {
    prefix: "M365-",
    suffix: "-Team",
    conflictBehavior: "block",
  },
  owners: ["user-admin-1"],
  members: ["user-member-1", "user-member-2"],
  settings: {
    hiddenFromGal: false,
    deliveryManagement: true,
  },
  licensing: ["SPE_E5"],
};

describe("Group templates CRUD routes and persistence (T-0265)", () => {
  it("round-trips §5 fields in SQLite repository", async () => {
    const repo = new SqliteGroupTemplateRepository(":memory:");
    try {
      const created = await repo.create(VALID_INPUT);
      expect(created.id).toBeDefined();
      expect(created.name).toBe("Department Standard Team");
      expect(created.groupType).toBe("m365");
      expect(created.naming.prefix).toBe("M365-");
      expect(created.naming.conflictBehavior).toBe("block");
      expect(created.owners).toEqual(["user-admin-1"]);
      expect(created.members).toEqual(["user-member-1", "user-member-2"]);
      expect(created.settings.deliveryManagement).toBe(true);
      expect(created.licensing).toEqual(["SPE_E5"]);
      expect(created.deletedAt).toBeNull();

      const fetched = await repo.get(created.id);
      expect(fetched).toEqual(created);

      const list = await repo.list();
      expect(list).toHaveLength(1);

      const updated = await repo.update(created.id, {
        name: "Renamed Team",
        licensing: ["SPE_E3"],
      });
      expect(updated?.name).toBe("Renamed Team");
      expect(updated?.licensing).toEqual(["SPE_E3"]);

      const deleted = await repo.delete(created.id);
      expect(deleted).toBe(true);

      const afterDelete = await repo.get(created.id);
      expect(afterDelete).toBeUndefined();

      const includeDeleted = await repo.get(created.id, { includeDeleted: true });
      expect(includeDeleted?.deletedAt).not.toBeNull();
    } finally {
      repo.close();
    }
  });

  it("rejects unauthenticated requests with 401", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    const routes = createGroupTemplatesRoutes({
      repository: repo,
      resolveCaller: () => undefined,
    });
    const listRoute = routes.find((r) => r.method === "GET" && r.path === GROUP_TEMPLATES_PATH)!;

    await expect(
      listRoute.handler({
        method: "GET",
        path: GROUP_TEMPLATES_PATH,
        params: {},
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects callers missing groups.templates with 403", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    const caller: GroupTemplatesCaller = {
      permissions: ["Identity.Group.Read"],
    };
    const routes = createGroupTemplatesRoutes({
      repository: repo,
      resolveCaller: () => caller,
    });
    const listRoute = routes.find((r) => r.method === "GET" && r.path === GROUP_TEMPLATES_PATH)!;

    await expect(
      listRoute.handler({
        method: "GET",
        path: GROUP_TEMPLATES_PATH,
        params: {},
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("creates, retrieves, edits, and deletes templates via routes", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    const caller: GroupTemplatesCaller = {
      permissions: [GROUP_TEMPLATES_PERMISSION],
    };
    const routes = createGroupTemplatesRoutes({
      repository: repo,
      resolveCaller: () => caller,
    });

    const postRoute = routes.find((r) => r.method === "POST" && r.path === GROUP_TEMPLATES_PATH)!;
    const getRoute = routes.find((r) => r.method === "GET" && r.path.includes(":id"))!;
    const patchRoute = routes.find((r) => r.method === "PATCH" && r.path.includes(":id"))!;
    const deleteRoute = routes.find((r) => r.method === "DELETE" && r.path.includes(":id"))!;
    const listRoute = routes.find((r) => r.method === "GET" && r.path === GROUP_TEMPLATES_PATH)!;

    // 1. Create
    const createRes = await postRoute.handler({
      method: "POST",
      path: GROUP_TEMPLATES_PATH,
      params: {},
      query: new URLSearchParams(),
      headers: {},
      body: VALID_INPUT,
    });
    expect(createRes.status).toBe(201);
    const created = createRes.body as any;
    expect(created.id).toBeDefined();

    // 2. List
    const listRes = await listRoute.handler({
      method: "GET",
      path: GROUP_TEMPLATES_PATH,
      params: {},
      query: new URLSearchParams(),
      headers: {},
    });
    expect(listRes.status).toBe(200);
    expect((listRes.body as any).items).toHaveLength(1);

    // 3. Get
    const getRes = await getRoute.handler({
      method: "GET",
      path: `/v1/group-templates/${created.id}`,
      params: { id: created.id },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(getRes.status).toBe(200);
    expect((getRes.body as any).name).toBe("Department Standard Team");

    // 4. Patch
    const patchRes = await patchRoute.handler({
      method: "PATCH",
      path: `/v1/group-templates/${created.id}`,
      params: { id: created.id },
      query: new URLSearchParams(),
      headers: {},
      body: { name: "Updated Name" },
    });
    expect(patchRes.status).toBe(200);
    expect((patchRes.body as any).name).toBe("Updated Name");

    // 5. Delete
    const deleteRes = await deleteRoute.handler({
      method: "DELETE",
      path: `/v1/group-templates/${created.id}`,
      params: { id: created.id },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(deleteRes.status).toBe(200);
    expect((deleteRes.body as any).deleted).toBe(true);

    // 6. 404 after delete
    await expect(
      getRoute.handler({
        method: "GET",
        path: `/v1/group-templates/${created.id}`,
        params: { id: created.id },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects invalid template creation with structured 400 errors", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    const caller: GroupTemplatesCaller = {
      permissions: [GROUP_TEMPLATES_PERMISSION],
    };
    const routes = createGroupTemplatesRoutes({
      repository: repo,
      resolveCaller: () => caller,
    });
    const postRoute = routes.find((r) => r.method === "POST" && r.path === GROUP_TEMPLATES_PATH)!;

    // Missing name
    await expect(
      postRoute.handler({
        method: "POST",
        path: GROUP_TEMPLATES_PATH,
        params: {},
        query: new URLSearchParams(),
        headers: {},
        body: { groupType: "security" },
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Invalid groupType
    await expect(
      postRoute.handler({
        method: "POST",
        path: GROUP_TEMPLATES_PATH,
        params: {},
        query: new URLSearchParams(),
        headers: {},
        body: { name: "Test", groupType: "invalidType" },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
