import { vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";

import { RECORD_TIME, milestoneRecord } from "./task-records";
import { patch } from "./task-ticket-store";

import type { TaskState } from "./task-records";

/** Replaces the milestone and dependency methods of the repository prototype. */
export function installMilestoneStore(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findMilestonesByProjectIds").mockImplementation(
    async (ids) =>
      [...state.milestones.values()].filter(
        (milestone) =>
          ids.includes(milestone.projectId) && milestone.archivedAt === null,
      ),
  );
  vi.spyOn(proto, "findMilestoneById").mockImplementation(
    async (id, options) => {
      const milestone = state.milestones.get(id);
      return milestone &&
        (options?.includeArchived || milestone.archivedAt === null)
        ? milestone
        : null;
    },
  );
  vi.spyOn(proto, "insertMilestone").mockImplementation(async (input) => {
    state.writes.push("insertMilestone");
    state.milestones.set(
      input.id,
      milestoneRecord(input.id, input.projectId, { ...input }),
    );
  });
  vi.spyOn(proto, "updateMilestone").mockImplementation(async (id, update) => {
    state.writes.push("updateMilestone");
    const stored = state.milestones.get(id);
    if (stored) state.milestones.set(id, { ...stored, ...update });
  });
  vi.spyOn(proto, "updateMilestoneField").mockImplementation(
    async (id, change) => {
      const hook = state.beforeWrite;
      state.beforeWrite = null;
      hook?.();
      const stored = state.milestones.get(id);
      if (!stored || stored[change.field] !== change.base) return false;
      state.writes.push("updateMilestoneField");
      state.milestones.set(id, { ...stored, [change.field]: change.value });
      return true;
    },
  );
  vi.spyOn(proto, "archiveMilestone").mockImplementation(async (id) => {
    state.writes.push("archiveMilestone");
    const stored = state.milestones.get(id);
    if (stored)
      state.milestones.set(id, { ...stored, archivedAt: RECORD_TIME });
  });
  installDependencyStore(state);
}

function installDependencyStore(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findDependenciesByProjectIds").mockImplementation(
    async (ids) =>
      state.dependencies.filter((dependency) =>
        ids.includes(dependency.projectId),
      ),
  );
  vi.spyOn(proto, "insertDependency").mockImplementation(async (input) => {
    state.writes.push("insertDependency");
    state.dependencies.push({ ...input, createdAt: RECORD_TIME });
  });
  vi.spyOn(proto, "deleteDependency").mockImplementation(async (id) => {
    state.writes.push("deleteDependency");
    state.dependencies = state.dependencies.filter(
      (dependency) => dependency.id !== id,
    );
  });
  vi.spyOn(proto, "deleteDependenciesByMilestone").mockImplementation(
    async (id) => {
      state.writes.push("deleteDependenciesByMilestone");
      state.dependencies = state.dependencies.filter(
        (dependency) =>
          dependency.sourceId !== id && dependency.targetId !== id,
      );
    },
  );
}

/** Replaces the initiative link methods of the repository prototype. */
export function installInitiativeLinks(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findMilestoneInitiativeLinks").mockImplementation(
    async (projectIds) =>
      state.initiativeLinks.filter((link) => {
        const milestone = state.milestones.get(link.milestoneId);
        return milestone && projectIds.includes(milestone.projectId);
      }),
  );
  vi.spyOn(proto, "linkInitiativeToMilestone").mockImplementation(
    async (milestoneId, initiativeId) => {
      state.writes.push("linkInitiativeToMilestone");
      state.initiativeLinks.push({ milestoneId, initiativeId });
    },
  );
  vi.spyOn(proto, "unlinkInitiativeFromMilestone").mockImplementation(
    async (milestoneId, initiativeId) => {
      state.writes.push("unlinkInitiativeFromMilestone");
      state.initiativeLinks = state.initiativeLinks.filter(
        (link) =>
          link.milestoneId !== milestoneId ||
          link.initiativeId !== initiativeId,
      );
    },
  );
  vi.spyOn(proto, "setMilestoneIfEmpty").mockImplementation(
    async (id, milestoneId) => {
      const stored = state.tickets.get(id);
      if (!stored || stored.milestoneId !== null) return false;
      state.writes.push("setMilestoneIfEmpty");
      patch(state, id, { milestoneId });
      return true;
    },
  );
  vi.spyOn(proto, "clearMilestone").mockImplementation(
    async (id, milestoneId) => {
      state.writes.push("clearMilestone");
      if (state.tickets.get(id)?.milestoneId === milestoneId)
        patch(state, id, { milestoneId: null });
    },
  );
  vi.spyOn(proto, "countMilestoneDependents").mockImplementation(
    async (initiativeId, milestoneId) => {
      const below = new Set([initiativeId]);
      for (const id of below)
        for (const ticket of state.tickets.values())
          if (ticket.parentId === id) below.add(ticket.id);
      below.delete(initiativeId);
      return [...below].filter(
        (id) => state.tickets.get(id)?.milestoneId === milestoneId,
      ).length;
    },
  );
}
