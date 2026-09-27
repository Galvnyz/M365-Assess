// EPIC-010 baselines and rollouts on real storage (T-0825).
//
// Baselines, stages, assignments, rollouts, history, and trend persist through the db
// baselines repository. The fleet view counts deviations from the drift repository, and
// migration reads its source template from the standards repository. Evaluating a
// baseline (Invoke-Baseline.ps1) is not wired; rollouts, history, and trend are written
// only by the advance route until it is (T-0841).
import { randomUUID } from "node:crypto";
import type {
  Baseline,
  SqliteBaselinesRepository,
  SqliteDriftRepository,
  SqliteStandardsRepository,
} from "@m365-assess/db";
import type { AdvanceHistoryPort, AdvanceStore } from "../routes/baselines-advance.js";
import type { AlignmentStore } from "../routes/baselines-alignment.js";
import type { FleetStore } from "../routes/baselines-fleet.js";
import type { MigrateStore } from "../routes/baselines-migrate.js";
import type { BaselineRecord, BaselinesStore } from "../routes/baselines.js";

/** The route's baseline: stages without the db's back-reference to their baseline. */
function toBaselineRecord(baseline: Baseline): BaselineRecord {
  return {
    ...baseline,
    stages: baseline.stages.map(({ order, conditions, action }) => ({ order, conditions, action })),
  };
}

async function getBaselineRecord(repo: SqliteBaselinesRepository, baselineId: string): Promise<BaselineRecord | undefined> {
  const baseline = await repo.getBaseline(baselineId);
  return baseline ? toBaselineRecord(baseline) : undefined;
}

export function createBaselinesStore(repo: SqliteBaselinesRepository): BaselinesStore {
  return {
    listBaselines: async () => (await repo.listBaselines()).map(toBaselineRecord),
    getBaseline: (baselineId) => getBaselineRecord(repo, baselineId),
    createBaseline: async (input) => toBaselineRecord(await repo.createBaseline(input)),
    async updateBaseline(baselineId, { stages, assignments, ...fields }) {
      if (!(await repo.updateBaseline(baselineId, fields))) return undefined;
      if (stages) await repo.setStages(baselineId, stages);
      if (assignments) await repo.setAssignments(baselineId, assignments);
      return getBaselineRecord(repo, baselineId);
    },
    deleteBaseline: (baselineId) => repo.deleteBaseline(baselineId),
    listBaselineAssignments: (baselineId) => repo.getAssignments(baselineId),
    setBaselineAssignments: (baselineId, assignments) => repo.setAssignments(baselineId, assignments),
  };
}

export function createBaselineAdvanceStore(repo: SqliteBaselinesRepository): AdvanceStore {
  return {
    getBaseline: (baselineId) => getBaselineRecord(repo, baselineId),
    getRollout: (baselineId, tenantId) => repo.getRollout(baselineId, tenantId),
    upsertRollout: (input) => repo.upsertRollout(input),
  };
}

export function createBaselineHistory(repo: SqliteBaselinesRepository): AdvanceHistoryPort {
  return {
    append: (event) => repo.appendHistory({ id: randomUUID(), ...event }),
  };
}

export function createBaselineAlignmentStore(repo: SqliteBaselinesRepository): AlignmentStore {
  return {
    getBaseline: (baselineId) => getBaselineRecord(repo, baselineId),
    listRollouts: (baselineId) => repo.listRollouts(baselineId),
    listHistory: (baselineId, limit) => repo.listHistory(baselineId, limit),
    listTrend: (baselineId) => repo.listTrend(baselineId),
  };
}

export function createBaselinesFleetStore(baselines: SqliteBaselinesRepository, drift: SqliteDriftRepository): FleetStore {
  return {
    listBaselines: async () => (await baselines.listBaselines()).map(toBaselineRecord),
    listRollouts: () => baselines.listAllRollouts(),
    countDeviationsByState: () => drift.countDeviationsByState(),
    openDeviationsByTenant: () => drift.countOpenDeviationsByTenant(),
  };
}

export function createBaselinesMigrateStore(
  standards: SqliteStandardsRepository,
  baselines: SqliteBaselinesRepository,
): MigrateStore {
  return {
    async getSourceTemplate(templateId) {
      const template = await standards.getStandardTemplate(templateId);
      if (!template) return undefined;
      const assignments = (await standards.listTemplateAssignments())
        .filter((assignment) => assignment.templateId === templateId)
        .map(({ targetType, targetId, precedence }) => ({ targetType, targetId, precedence }));
      return { id: template.id, name: template.name, kind: template.kind, settings: template.settings, assignments };
    },
    createBaseline: async (input) => toBaselineRecord(await baselines.createBaseline(input)),
  };
}
