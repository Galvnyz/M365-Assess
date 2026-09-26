// T-0166 — drift deny/queued-deletion state machine.
import { describe, expect, it } from "vitest";
import {
  DRIFT_DENY_CONFIRMATION_REQUIRED,
  DRIFT_DENY_WARNING,
  DriftDenyInputError,
  buildDeleteInstruction,
  buildDeletePendingPatch,
  buildDenyPatch,
  isDeletionDue,
  parseDenyInput,
  promoteDueDenials,
} from "./drift-delete-queue.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("parseDenyInput (T-0166)", () => {
  it("requires explicit confirmation with the verbatim warning", () => {
    try {
      parseDenyInput({ reason: "duplicate" });
      throw new Error("expected a confirmation error");
    } catch (error) {
      expect(error).toBeInstanceOf(DriftDenyInputError);
      expect((error as DriftDenyInputError).code).toBe(DRIFT_DENY_CONFIRMATION_REQUIRED);
      expect((error as DriftDenyInputError).message).toContain(DRIFT_DENY_WARNING);
    }
  });

  it("requires a reason and validates the delay", () => {
    expect(() => parseDenyInput({ confirm: true })).toThrow(DriftDenyInputError);
    expect(() => parseDenyInput({ confirm: true, reason: "x", delayDays: -1 })).toThrow(DriftDenyInputError);
    expect(parseDenyInput({ confirm: true, reason: "duplicate" })).toEqual({
      reason: "duplicate",
      confirm: true,
      delayDays: 0,
    });
    expect(parseDenyInput({ confirm: true, reason: "x", delayDays: 3.9 }).delayDays).toBe(3);
  });
});

describe("deny/delete-pending patches (T-0166)", () => {
  it("marks denied with the grace window in expiresOn", () => {
    const patch = buildDenyPatch({ reason: "duplicate", confirm: true, delayDays: 2 }, NOW);
    expect(patch.state).toBe("denied");
    expect(patch.reason).toBe("duplicate");
    expect(patch.expiresOn).toBe("2026-01-03T00:00:00.000Z");
  });

  it("promotes to deletePending", () => {
    expect(buildDeletePendingPatch().state).toBe("deletePending");
  });
});

describe("isDeletionDue / promoteDueDenials (T-0166)", () => {
  it("is due only for denied rows past their grace window", () => {
    expect(isDeletionDue({ state: "denied", expiresOn: "2025-12-31T00:00:00.000Z" }, NOW)).toBe(true);
    expect(isDeletionDue({ state: "denied", expiresOn: "2026-02-01T00:00:00.000Z" }, NOW)).toBe(false);
    // No window recorded -> due.
    expect(isDeletionDue({ state: "denied", expiresOn: null }, NOW)).toBe(true);
    // Not a denied row.
    expect(isDeletionDue({ state: "open", expiresOn: null }, NOW)).toBe(false);
    expect(isDeletionDue({ state: "deletePending", expiresOn: null }, NOW)).toBe(false);
  });

  it("selects only the due denials", () => {
    const rows = [
      { id: "a", state: "denied" as const, expiresOn: "2025-12-31T00:00:00.000Z" },
      { id: "b", state: "denied" as const, expiresOn: "2026-02-01T00:00:00.000Z" },
      { id: "c", state: "open" as const, expiresOn: null },
    ];
    expect(promoteDueDenials(rows, NOW).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("buildDeleteInstruction (T-0166)", () => {
  it("builds an EPIC-006 deletion instruction for a deletePending row", () => {
    const instruction = buildDeleteInstruction(
      {
        tenantId: "t1",
        standardKey: "extra:conditionalAccess",
        resourceId: "policy-1",
        state: "deletePending",
        reason: "duplicate",
        expiresOn: "2026-01-01T00:00:00.000Z",
      },
      NOW,
    );
    expect(instruction).toEqual({
      kind: "drift-deny-delete",
      tenantId: "t1",
      standardKey: "extra:conditionalAccess",
      resourceId: "policy-1",
      reason: "duplicate",
      notBefore: "2026-01-01T00:00:00.000Z",
    });
  });

  it("refuses to build a deletion for a non-delete-pending row", () => {
    expect(() =>
      buildDeleteInstruction(
        { tenantId: "t1", standardKey: "k", resourceId: "r", state: "denied", reason: null, expiresOn: null },
        NOW,
      ),
    ).toThrow(DriftDenyInputError);
  });
});
