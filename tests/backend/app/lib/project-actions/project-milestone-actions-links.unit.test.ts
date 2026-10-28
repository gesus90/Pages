import { beforeEach, expect, it, vi } from "vitest";

import { handleSaveMilestone } from "@/app/lib/project-actions/project-milestone-actions.server";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { ACTOR, outcomeOf } from "../../actions/action-fixtures";
import { PROJECT_ID, projectContext } from "./project-action-fixtures";
import {
  MILESTONE,
  dependencyOf,
  milestoneServices,
} from "./project-milestone-fixtures";

import type { FormFields } from "../../actions/action-fixtures";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const { taskService } = milestoneServices;
const SUCCEEDED = { body: { ok: true }, status: 200 };
const STORED_LINK = dependencyOf("dep-1");

beforeEach(() => {
  vi.resetAllMocks();
  taskService.findMilestones.mockResolvedValue([MILESTONE]);
  taskService.findDependencies.mockResolvedValue([]);
});

async function saveLinks(links: FormFields): Promise<unknown> {
  const fields = { milestoneId: MILESTONE.id, status: "open", ...links };
  const outcome = await outcomeOf(
    await handleSaveMilestone(projectContext(milestoneServices, fields)),
  );

  return { body: outcome.body, status: outcome.status };
}

function linkList(...links: readonly object[]): string {
  return JSON.stringify(links);
}

it("removes the stored dependencies and skips ones already gone", async () => {
  taskService.findDependencies.mockResolvedValue([STORED_LINK]);

  const result = await saveLinks({ removeLinks: '["dep-gone","dep-1"]' });

  expect(result).toEqual(SUCCEEDED);
  expect(taskService.findDependencies).toHaveBeenCalledWith(ACTOR, [
    PROJECT_ID,
  ]);
  expect(taskService.removeDependency).toHaveBeenCalledExactlyOnceWith(
    ACTOR,
    PROJECT_ID,
    "dep-1",
  );
});

it("tolerates a removal that a parallel submission already did", async () => {
  const conflict = new WorkItemValidationError("dependencyNotFound");
  taskService.findDependencies
    .mockResolvedValueOnce([STORED_LINK])
    .mockResolvedValueOnce([]);
  taskService.removeDependency.mockRejectedValue(conflict);

  expect(await saveLinks({ removeLinks: '["dep-1"]' })).toEqual(SUCCEEDED);
  expect(logCaughtError).toHaveBeenCalledWith(
    "project_milestone_actions",
    conflict,
  );
});

it("fails a refused removal whose dependency is still stored", async () => {
  const refusal = new WorkItemValidationError("dependencyNotFound");
  taskService.findDependencies.mockResolvedValue([STORED_LINK]);
  taskService.removeDependency.mockRejectedValue(refusal);

  await expect(saveLinks({ removeLinks: '["dep-1"]' })).rejects.toBe(refusal);
});

it("fails a removal that broke for another reason", async () => {
  const failure = new Error("database unavailable");
  taskService.findDependencies.mockResolvedValue([STORED_LINK]);
  taskService.removeDependency.mockRejectedValue(failure);

  await expect(saveLinks({ removeLinks: '["dep-1"]' })).rejects.toBe(failure);
  expect(taskService.findDependencies).toHaveBeenCalledTimes(1);
});

it("adds only the dependencies that are not stored yet", async () => {
  taskService.findDependencies.mockResolvedValue([
    dependencyOf("dep-other-source", { sourceId: "milestone-0" }),
    dependencyOf("dep-other-target", { targetId: "milestone-5" }),
    dependencyOf("dep-other-type", { linkType: "relates_to" }),
    dependencyOf("dep-same", { linkType: "follows", targetId: "milestone-3" }),
  ]);
  const addLinks = linkList(
    { extra: "ignored", linkType: "blocks", targetId: "milestone-2" },
    { linkType: "follows", targetId: "milestone-3" },
  );

  expect(await saveLinks({ addLinks })).toEqual(SUCCEEDED);
  expect(taskService.addDependency).toHaveBeenCalledExactlyOnceWith(ACTOR, {
    linkType: "blocks",
    projectId: PROJECT_ID,
    sourceId: MILESTONE.id,
    targetId: "milestone-2",
  });
});

it("tolerates an addition that a parallel submission already stored", async () => {
  const duplicate = new WorkItemValidationError("dependencyExists");
  taskService.findDependencies
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([STORED_LINK]);
  taskService.addDependency.mockRejectedValue(duplicate);
  const addLinks = linkList({ linkType: "blocks", targetId: "milestone-2" });

  expect(await saveLinks({ addLinks })).toEqual(SUCCEEDED);
  expect(logCaughtError).toHaveBeenCalledWith(
    "project_milestone_actions",
    duplicate,
  );
});

it("fails a refused addition that left no dependency", async () => {
  const refusal = new WorkItemValidationError("dependencySelf");
  taskService.addDependency.mockRejectedValue(refusal);
  const addLinks = linkList({ linkType: "blocks", targetId: "milestone-2" });

  await expect(saveLinks({ addLinks })).rejects.toBe(refusal);
  expect(taskService.findDependencies).toHaveBeenCalledTimes(2);
});

it("fails an addition that broke for another reason", async () => {
  const failure = new Error("database unavailable");
  taskService.addDependency.mockRejectedValue(failure);
  const addLinks = linkList({ linkType: "blocks", targetId: "milestone-2" });

  await expect(saveLinks({ addLinks })).rejects.toBe(failure);
  expect(taskService.findDependencies).toHaveBeenCalledTimes(1);
});

it("removes before it adds", async () => {
  taskService.findDependencies.mockResolvedValue([STORED_LINK]);
  const addLinks = linkList({ linkType: "follows", targetId: "milestone-4" });

  await saveLinks({ addLinks, removeLinks: '["dep-1"]' });

  const removeOrder = taskService.removeDependency.mock.invocationCallOrder[0];
  const addOrder = taskService.addDependency.mock.invocationCallOrder[0];
  expect(removeOrder).toBeLessThan(addOrder ?? 0);
  expect(taskService.updateMilestone.mock.invocationCallOrder[0]).toBeLessThan(
    removeOrder ?? 0,
  );
});
