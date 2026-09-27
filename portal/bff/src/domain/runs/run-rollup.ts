// Parent run status from its per-tenant child runs (EPIC-003 SPEC.md §3.1, §3.3).
// A parent is queued until a child starts, running until every child is terminal,
// then succeeded, failed, or cancelled when all children agree and partial when they
// do not. Pure: callers load the children and persist the result.

export type RollupStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial";

export interface RollupChild {
  readonly status: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface RunRollup {
  readonly status: RollupStatus;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

const TERMINAL: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled", "partial"]);

function earliest(values: readonly (string | null)[]): string | null {
  const present = values.filter((v): v is string => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => (a < b ? a : b));
}

function latest(values: readonly (string | null)[]): string | null {
  const present = values.filter((v): v is string => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => (a > b ? a : b));
}

export function rollupRunStatus(children: readonly RollupChild[]): RunRollup {
  const startedAt = earliest(children.map((c) => c.startedAt));
  if (children.length > 0 && children.every((c) => TERMINAL.has(c.status))) {
    const first = children[0]!.status;
    const agreed = children.every((c) => c.status === first) && first !== "partial";
    return {
      status: agreed ? (first as RollupStatus) : "partial",
      startedAt,
      finishedAt: latest(children.map((c) => c.finishedAt)),
    };
  }
  const started = children.some((c) => c.status !== "queued");
  return { status: started ? "running" : "queued", startedAt, finishedAt: null };
}
