import { vi } from "vitest";

import type { Milestone, MilestoneDependency } from "@/definition/Task";

/** The stored milestone the milestone action tests save and change. */
export const MILESTONE: Milestone = {
  archivedAt: null,
  colorCustom: "#112233",
  colorKey: "release",
  completedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  description: "Stored description",
  dueAt: "2026-03-31",
  iconKey: "rocket",
  id: "milestone-1",
  name: "Beta",
  projectId: "project-1",
  startAt: "2026-02-01",
  status: "open",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

/** Task service fakes the milestone action handlers call. */
export const milestoneServices = {
  taskService: {
    addDependency: vi.fn(),
    archiveMilestone: vi.fn(),
    createMilestone: vi.fn(),
    findDependencies: vi.fn(),
    findMilestones: vi.fn(),
    removeDependency: vi.fn(),
    updateMilestone: vi.fn(),
  },
};

/**
 * Builds a stored dependency that starts at the test milestone.
 *
 * @param id - Identifier of the dependency.
 * @param change - Values that differ from a `blocks` link to `milestone-2`.
 */
export function dependencyOf(
  id: string,
  change: Partial<MilestoneDependency> = {},
): MilestoneDependency {
  return {
    createdAt: "2026-01-03T00:00:00.000Z",
    id,
    linkType: "blocks",
    projectId: "project-1",
    sourceId: MILESTONE.id,
    targetId: "milestone-2",
    ...change,
  };
}
