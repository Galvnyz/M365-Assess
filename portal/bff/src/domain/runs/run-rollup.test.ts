import { describe, expect, it } from "vitest";
import { rollupRunStatus } from "./run-rollup.js";

const child = (status: string, startedAt: string | null = null, finishedAt: string | null = null) => ({ status, startedAt, finishedAt });

describe("rollupRunStatus", () => {
  it("stays queued until a child starts, then runs until all finish", () => {
    expect(rollupRunStatus([child("queued"), child("queued")]).status).toBe("queued");
    expect(rollupRunStatus([child("running", "t1"), child("queued")])).toEqual({ status: "running", startedAt: "t1", finishedAt: null });
    expect(rollupRunStatus([child("succeeded", "t1", "t2"), child("queued")]).status).toBe("running");
  });

  it("takes the shared terminal status, or partial when children differ", () => {
    expect(rollupRunStatus([child("succeeded", "t2", "t5"), child("succeeded", "t1", "t4")])).toEqual({
      status: "succeeded",
      startedAt: "t1",
      finishedAt: "t5",
    });
    expect(rollupRunStatus([child("failed"), child("failed")]).status).toBe("failed");
    expect(rollupRunStatus([child("cancelled"), child("cancelled")]).status).toBe("cancelled");
    expect(rollupRunStatus([child("succeeded"), child("failed")]).status).toBe("partial");
    expect(rollupRunStatus([child("partial"), child("partial")]).status).toBe("partial");
  });
});
