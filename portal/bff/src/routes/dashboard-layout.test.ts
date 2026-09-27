import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AppError, ErrorCodes } from "../errors.js";
import { buildServer, type Route } from "../server.js";
import {
  DASHBOARD_LAYOUT_OPENAPI,
  DASHBOARD_LAYOUT_PATH,
  createDashboardLayoutRoutes,
  getDashboardLayout,
  putDashboardLayout,
  type DashboardLayout,
  type DashboardLayoutStore,
  type DashboardWidgetPlacement,
} from "./dashboard-layout.js";

const USER_A = "user-a";
const USER_B = "user-b";
const TENANT_A = "tenant-a";

const STOCK: readonly DashboardWidgetPlacement[] = [
  { id: "TenantInfoCard", position: 0, size: { width: 4, height: 2 }, settings: {} },
  { id: "AlertsOverviewCard", position: 1, size: { width: 12, height: 2 }, settings: {} },
];

function cloneWidget(widget: DashboardWidgetPlacement): DashboardWidgetPlacement {
  return {
    id: widget.id,
    position: widget.position,
    size: { ...widget.size },
    settings: { ...widget.settings },
  };
}

function cloneLayout(layout: DashboardLayout): DashboardLayout {
  return { ...layout, widgets: layout.widgets.map(cloneWidget) };
}

function stockLayout(userId: string, tenantId: string | null): DashboardLayout {
  const scope = tenantId === null ? "global" : "tenant";
  return {
    id: `layout:${userId}:${scope}:${tenantId ?? "global"}`,
    userId,
    scope,
    tenantId,
    widgets: STOCK.map(cloneWidget),
    isDefault: true,
    createdAt: null,
    updatedAt: null,
  };
}

class FakeStore implements DashboardLayoutStore {
  private readonly rows = new Map<string, DashboardLayout>();
  private clock = 0;

  private key(userId: string, tenantId: string | null): string {
    return `${userId}|${tenantId ?? ""}`;
  }

  async getLayout(
    userId: string,
    lookup: { tenantId?: string | null } = {},
  ): Promise<DashboardLayout> {
    const tenantId = lookup.tenantId ?? null;
    const found = this.rows.get(this.key(userId, tenantId));
    return found ? cloneLayout(found) : stockLayout(userId, tenantId);
  }

  async saveLayout(
    userId: string,
    input: { tenantId?: string | null; widgets: readonly DashboardWidgetPlacement[] },
  ): Promise<DashboardLayout> {
    const tenantId = input.tenantId ?? null;
    this.clock += 1;
    const scope = tenantId === null ? "global" : "tenant";
    const existing = this.rows.get(this.key(userId, tenantId));
    const layout: DashboardLayout = {
      id: `layout:${userId}:${scope}:${tenantId ?? "global"}`,
      userId,
      scope,
      tenantId,
      widgets: input.widgets.map(cloneWidget),
      isDefault: false,
      createdAt: existing?.createdAt ?? "2026-01-01T00:00:00.000Z",
      updatedAt: `2026-01-01T00:00:0${this.clock}.000Z`,
    };
    this.rows.set(this.key(userId, tenantId), layout);
    return cloneLayout(layout);
  }

  async resetLayout(
    userId: string,
    lookup: { tenantId?: string | null } = {},
  ): Promise<DashboardLayout> {
    const tenantId = lookup.tenantId ?? null;
    this.rows.delete(this.key(userId, tenantId));
    return this.getLayout(userId, { tenantId });
  }
}

function widget(id: string, position = 0): DashboardWidgetPlacement {
  return { id, position, size: { width: 4, height: 2 }, settings: {} };
}

const openServers: Server[] = [];

async function startServer(routes: readonly Route[]) {
  const server = buildServer({ routes });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  openServers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("dashboard layout handlers", () => {
  it("returns the store default when the caller has no layout", async () => {
    const store = new FakeStore();
    const response = await getDashboardLayout(store, {
      caller: { userId: USER_A },
      tenantId: TENANT_A,
    });
    const layout = response.body["layout"] as DashboardLayout;
    expect(response.status).toBe(200);
    expect(layout.isDefault).toBe(true);
    expect(layout.widgets.map((item) => item.id)).toEqual(STOCK.map((item) => item.id));
  });

  it("round-trips a saved layout through PUT then GET", async () => {
    const store = new FakeStore();
    const widgets = [widget("SecureScoreCard", 0), widget("MFACard", 1)];

    const put = await putDashboardLayout(store, {
      caller: { userId: USER_A },
      tenantId: TENANT_A,
      body: { widgets },
    });
    expect(put.status).toBe(200);

    const get = await getDashboardLayout(store, {
      caller: { userId: USER_A },
      tenantId: TENANT_A,
    });
    const layout = get.body["layout"] as DashboardLayout;
    expect(layout.isDefault).toBe(false);
    expect(layout.widgets).toEqual(widgets);
  });

  it("resets to the stock layout when the body asks", async () => {
    const store = new FakeStore();
    await putDashboardLayout(store, {
      caller: { userId: USER_A },
      tenantId: TENANT_A,
      body: { widgets: [widget("LicenseCard")] },
    });

    const reset = await putDashboardLayout(store, {
      caller: { userId: USER_A },
      tenantId: TENANT_A,
      body: { reset: true },
    });
    const layout = reset.body["layout"] as DashboardLayout;
    expect(layout.isDefault).toBe(true);
    expect(layout.widgets.map((item) => item.id)).toEqual(STOCK.map((item) => item.id));
  });

  it("keeps one user's layout out of another user's reads and writes", async () => {
    const store = new FakeStore();
    await putDashboardLayout(store, {
      caller: { userId: USER_A },
      tenantId: TENANT_A,
      body: { widgets: [widget("TenantInfoCard")] },
    });
    await putDashboardLayout(store, {
      caller: { userId: USER_B },
      tenantId: TENANT_A,
      body: { widgets: [widget("MFACard")] },
    });

    const a = await getDashboardLayout(store, { caller: { userId: USER_A }, tenantId: TENANT_A });
    const b = await getDashboardLayout(store, { caller: { userId: USER_B }, tenantId: TENANT_A });
    expect((a.body["layout"] as DashboardLayout).widgets).toEqual([widget("TenantInfoCard")]);
    expect((b.body["layout"] as DashboardLayout).widgets).toEqual([widget("MFACard")]);
  });

  it("rejects malformed layout bodies", async () => {
    const store = new FakeStore();
    await expect(
      putDashboardLayout(store, {
        caller: { userId: USER_A },
        tenantId: null,
        body: { widgets: "not-an-array" },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.validationFailed, status: 400 });

    await expect(
      putDashboardLayout(store, {
        caller: { userId: USER_A },
        tenantId: null,
        body: { widgets: [{ position: 0, size: { width: 1, height: 1 } }] },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.validationFailed, status: 400 });

    await expect(
      putDashboardLayout(store, {
        caller: { userId: USER_A },
        tenantId: null,
        body: null,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("dashboard layout routes", () => {
  it("rejects an unauthenticated caller with a structured 401", async () => {
    const store = new FakeStore();
    const baseUrl = await startServer(
      createDashboardLayoutRoutes({ store, resolveCaller: () => undefined }),
    );
    const response = await fetch(`${baseUrl}${DASHBOARD_LAYOUT_PATH}`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: "request.unauthenticated",
      correlationId: expect.any(String),
    });
  });

  it("serves GET and PUT filtered by the caller's identity", async () => {
    const store = new FakeStore();
    let requestBody: unknown;
    const routes = createDashboardLayoutRoutes({
      store,
      resolveCaller: (ctx) => {
        const raw = ctx.headers["x-user-id"];
        const userId = Array.isArray(raw) ? raw[0] : raw;
        return typeof userId === "string" && userId.length > 0 ? { userId } : undefined;
      },
      readBody: () => requestBody,
    });
    const baseUrl = await startServer(routes);
    const headers = { "x-user-id": USER_A };

    const initial = await fetch(`${baseUrl}${DASHBOARD_LAYOUT_PATH}?tenantId=${TENANT_A}`, {
      headers,
    });
    expect(initial.status).toBe(200);
    expect(((await initial.json()) as { layout: DashboardLayout }).layout.isDefault).toBe(true);

    requestBody = { widgets: [widget("SecureScoreCard")] };
    const saved = await fetch(`${baseUrl}${DASHBOARD_LAYOUT_PATH}?tenantId=${TENANT_A}`, {
      method: "PUT",
      headers,
    });
    expect(saved.status).toBe(200);

    const reloaded = await fetch(`${baseUrl}${DASHBOARD_LAYOUT_PATH}?tenantId=${TENANT_A}`, {
      headers,
    });
    const layout = ((await reloaded.json()) as { layout: DashboardLayout }).layout;
    expect(layout.widgets).toEqual([widget("SecureScoreCard")]);
  });

  it("publishes both operations and their permissions through the route module", () => {
    const path = DASHBOARD_LAYOUT_OPENAPI.paths["/dashboard/layout"];
    expect(path.get.permission).toBe("Portal.Dashboard.Read");
    expect(path.put.permission).toBe("Portal.Dashboard.ReadWrite");
    expect(DASHBOARD_LAYOUT_OPENAPI.schemas.DashboardWidgetPlacement).toBeDefined();
  });
});
