// EPIC-009 drift on real storage (T-0825).
//
// Deviations and their triage persist through the db drift repository. Two things are
// not wired, and are refused with 501 (T-0841):
//
// - Refresh: Invoke-Drift.ps1 has no worker entrypoint to recompute a tenant's deviations.
// - Deletion: a deny whose deletion is due hands the delete to EPIC-006, whose apply jobs
//   do not run yet (T-0838). The deny routes write triage state before they queue the
//   delete, so `refuseDriftDeletion` refuses them before the route runs rather than
//   letting the queue fail after the deviation is marked pending.
import type { SqliteDriftRepository } from "@m365-assess/db";
import { AppError } from "../errors.js";
import type { DriftBulkStore } from "../routes/drift-bulk.js";
import { DRIFT_DENY_PATH } from "../routes/drift-deny.js";
import type { DriftRefresh, DriftStore } from "../routes/drift.js";
import type { DriftRemediationPort } from "../routes/drift-deny.js";
import type { Route } from "../server.js";
import { JOB_DISPATCH_UNAVAILABLE } from "./automation.js";

function unavailable(message: string): AppError {
  return new AppError(JOB_DISPATCH_UNAVAILABLE, message, 501);
}

export function createDriftStore(repo: SqliteDriftRepository): DriftStore {
  return {
    listDeviations: (tenantId, options) => repo.listDeviations(tenantId, options),
    listAllDeviations: () => repo.listAllDeviations(),
  };
}

/** The triage store for the accept, override, deny, and bulk routes. */
export function createDriftTriageStore(repo: SqliteDriftRepository): DriftBulkStore {
  return {
    getDeviationById: (deviationId) => repo.getDeviationById(deviationId),
    applyTriageByDeviationId: (deviationId, patch) => repo.setDeviationTriageById(deviationId, patch),
  };
}

export function createUnavailableDriftRefresh(): DriftRefresh {
  return {
    async refresh() {
      throw unavailable("drift cannot be recomputed yet: the drift worker has no entrypoint");
    },
  };
}

/** Never reached while `refuseDriftDeletion` guards the deny routes. */
export function createUnavailableDriftDeletion(): DriftRemediationPort {
  return {
    async queueDeletion() {
      throw unavailable("drift deletions cannot run yet: remediation apply jobs do not run");
    },
  };
}

/**
 * Refuse a deny that deletes: every single deny, and bulk `deny-delete`. `authorize`
 * runs first so an anonymous or unpermitted caller still gets 401/403. Bulk accept and
 * deny-remediate only record triage state and pass through.
 */
export function refuseDriftDeletion(route: Route, authorize: (ctx: Parameters<Route["handler"]>[0]) => void): Route {
  return {
    ...route,
    handler: (ctx) => {
      const body = ctx.body as { action?: unknown } | null | undefined;
      if (route.path === DRIFT_DENY_PATH || body?.action === "deny-delete") {
        authorize(ctx);
        throw unavailable("denying a deviation for deletion is not available yet: remediation apply jobs do not run");
      }
      return route.handler(ctx);
    },
  };
}
