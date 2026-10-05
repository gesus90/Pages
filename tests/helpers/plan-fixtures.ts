import type { Milestone, MilestoneDependency } from "@/definition/Task";

/** Creates a milestone with a start date in September 2026. */
export function createMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: "2026-01-01 00:00:00",
    description: "",
    dueAt: null,
    id: "m1",
    name: "Milestone",
    projectId: "project-1",
    startAt: "2026-09-10",
    status: "open",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

/** Creates a dependency of `m1` on `m2`. */
export function createLink(
  overrides: Partial<MilestoneDependency> = {},
): MilestoneDependency {
  return {
    createdAt: "2026-01-01 00:00:00",
    id: "l1",
    linkType: "prerequisite",
    projectId: "project-1",
    sourceId: "m1",
    targetId: "m2",
    ...overrides,
  };
}
