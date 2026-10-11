import { expect, it, vi } from "vitest";

import { TaskMilestoneService } from "@/backend/service/task/TaskMilestoneService";

import { createUser } from "../helpers/factories";
import { fieldMilestone, taskFieldDoubles } from "../helpers/task-fields";

import type { MilestoneFieldInput } from "@/backend/service/task/TaskMilestoneService";

const actor = createUser();

function setup() {
  const run = taskFieldDoubles();
  vi.spyOn(run.repository, "findMilestoneById").mockResolvedValue(
    fieldMilestone(),
  );
  vi.spyOn(run.repository, "updateMilestoneField").mockResolvedValue(true);
  const planning = vi
    .spyOn(run.access, "requirePlanningProject")
    .mockResolvedValue(undefined);
  const milestones = new TaskMilestoneService(
    run.repository,
    run.access,
    run.cache,
  );
  return { ...run, planning, milestones };
}

const changes: readonly MilestoneFieldInput[] = [
  { field: "name", base: "Release", value: " New release " },
  { field: "description", base: "Body", value: " Updated " },
  { field: "description", base: "Body", value: null },
  { field: "status", base: "open", value: "completed" },
  { field: "startAt", base: null, value: "2026-01-01" },
  { field: "dueAt", base: null, value: "2026-02-01" },
];

it.each(changes)(
  "normalizes and writes only $field with $value",
  async (change) => {
    const run = setup();
    const result = await run.milestones.updateMilestoneField(
      actor,
      "milestone",
      change,
    );
    expect(result).toEqual({ isChanged: true, milestone: fieldMilestone() });
    expect(run.repository.updateMilestoneField).toHaveBeenCalledExactlyOnceWith(
      "milestone",
      {
        ...change,
        value: change.value?.trim() ?? "",
      },
    );
    expect(run.planning).toHaveBeenCalledWith(actor, "project-1");
    expect(run.methods.invalidate).toHaveBeenCalledOnce();
  },
);

it.each([
  { field: "name", base: "Release", value: null, code: "milestoneNameLength" },
  {
    field: "status",
    base: "open",
    value: "paused",
    code: "milestoneStatusUnsupported",
  },
] as const)(
  "rejects invalid $field before persistence",
  async ({ code, ...change }) => {
    const run = setup();
    await expect(
      run.milestones.updateMilestoneField(actor, "milestone", change),
    ).rejects.toMatchObject({ code });
    expect(run.repository.updateMilestoneField).not.toHaveBeenCalled();
  },
);

it("returns an unchanged milestone for an already applied value even with an old base", async () => {
  const run = setup();
  expect(
    await run.milestones.updateMilestoneField(actor, "milestone", {
      field: "name",
      base: "obsolete",
      value: "Release",
    }),
  ).toEqual({ isChanged: false, milestone: fieldMilestone() });
  expect(run.repository.updateMilestoneField).not.toHaveBeenCalled();
  expect(run.methods.invalidate).not.toHaveBeenCalled();
});

it("rejects stale values and races without cache invalidation", async () => {
  const run = setup();
  await expect(
    run.milestones.updateMilestoneField(actor, "milestone", {
      field: "name",
      base: "obsolete",
      value: "New",
    }),
  ).rejects.toMatchObject({ field: "name" });
  expect(run.repository.updateMilestoneField).not.toHaveBeenCalled();
  vi.mocked(run.repository.updateMilestoneField).mockResolvedValue(false);
  await expect(
    run.milestones.updateMilestoneField(actor, "milestone", {
      field: "name",
      base: "Release",
      value: "New",
    }),
  ).rejects.toMatchObject({ field: "name" });
  expect(run.methods.invalidate).not.toHaveBeenCalled();
});

it("reports a milestone that disappears after a successful field write", async () => {
  const run = setup();
  vi.mocked(run.repository.findMilestoneById)
    .mockResolvedValueOnce(fieldMilestone())
    .mockResolvedValueOnce(null);
  await expect(
    run.milestones.updateMilestoneField(actor, "milestone", {
      field: "name",
      base: "Release",
      value: "New",
    }),
  ).rejects.toThrow("Updated milestone could not be retrieved.");
});
