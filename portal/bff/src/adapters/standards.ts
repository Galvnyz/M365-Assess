// EPIC-008 standards templates, alignment, and runs on real storage (T-0825).
//
// Templates, assignments, and compare rows persist through the db standards repository;
// a template's schedule is a row in the EPIC-007 schedule store. Running a standard
// now is not wired: Invoke-Standard.ps1 has no worker entrypoint, so the run route is
// refused with 501 before anything is enqueued (T-0841). The catalog classifies
// standards against a tenant's licences only once tenant licence inventory exists
// (T-0828); until then a tenant-scoped catalog request is refused with 501.
import {
  toStandardCompareView,
  toStandardDefinitionView,
  type SqliteScheduleRepository,
  type SqliteStandardsRepository,
} from "@m365-assess/db";
import { AppError } from "../errors.js";
import type { TenantLicenseSet } from "../domain/standards-license.js";
import type { AlignmentStore } from "../routes/standards-alignment.js";
import type { StandardsCatalogStore } from "../routes/standards-catalog.js";
import type { StandardsRunQueue, StandardsRunStore } from "../routes/standards-run.js";
import type { StandardsTemplateStore } from "../routes/standards-templates.js";
import { JOB_DISPATCH_UNAVAILABLE } from "./automation.js";

export const TENANT_LICENSES_UNAVAILABLE = "standards.tenant_licenses_unavailable";

/** Registry definitions, curated overrides applied, with the check reference renamed. */
export function createStandardsCatalogStore(repo: SqliteStandardsRepository): StandardsCatalogStore {
  return {
    listDefinitions: async () => (await repo.listDefinitions()).map(toStandardDefinitionView),
  };
}

export async function unavailableTenantLicenses(): Promise<TenantLicenseSet> {
  throw new AppError(
    TENANT_LICENSES_UNAVAILABLE,
    "tenant licence inventory is not available yet: the catalog cannot be classified for a tenant",
    501,
  );
}

export function createStandardsTemplateStore(repo: SqliteStandardsRepository): StandardsTemplateStore {
  return {
    listStandardTemplates: () => repo.listStandardTemplates(),
    getStandardTemplate: (templateId) => repo.getStandardTemplate(templateId),
    createStandardTemplate: ({ settings, ...input }) =>
      repo.createStandardTemplate({ ...input, ...(settings ? { settings: [...settings] } : {}) }),
    updateStandardTemplate: (templateId, patch) => repo.updateStandardTemplate(templateId, patch),
    deleteStandardTemplate: (templateId) => repo.deleteStandardTemplate(templateId),
    listTemplateAssignments: () => repo.listTemplateAssignments(),
    upsertTemplateAssignment: (input) => repo.upsertTemplateAssignment(input),
  };
}

/** Compare rows with the check reference renamed for the routes. */
export function createStandardsAlignmentStore(repo: SqliteStandardsRepository): AlignmentStore {
  return {
    listCompare: async (tenantId) => (await repo.listCompare(tenantId)).map(toStandardCompareView),
  };
}

export function createStandardsRunStore(
  standards: SqliteStandardsRepository,
  schedules: SqliteScheduleRepository,
): StandardsRunStore {
  return {
    getStandardTemplate: (templateId) => standards.getStandardTemplate(templateId),
    updateStandardTemplate: (templateId, patch) => standards.updateStandardTemplate(templateId, patch),
    createSchedule: (input) => schedules.createSchedule({ ...input, targetScope: { ...input.targetScope } }),
    softDeleteSchedule: (scheduleId) => schedules.softDeleteSchedule(scheduleId),
  };
}

export function createUnavailableStandardsRunQueue(): StandardsRunQueue {
  return {
    async enqueue() {
      throw new AppError(
        JOB_DISPATCH_UNAVAILABLE,
        "standards cannot run yet: the standards worker has no entrypoint",
        501,
      );
    },
  };
}
