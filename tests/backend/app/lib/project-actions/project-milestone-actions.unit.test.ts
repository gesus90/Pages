import { beforeEach, expect, it, vi } from "vitest";

import {
  handleArchiveMilestone,
  handleCreateMilestone,
  handleSaveMilestone,
  handleUpdateMilestoneStatus,
} from "@/app/lib/project-actions/project-milestone-actions.server";
import { logCaughtError } from "@/backend/logging/Logger";

import { ACTOR, outcomeOf } from "../../actions/action-fixtures";
import { PROJECT_ID, projectContext } from "./project-action-fixtures";
import { MILESTONE, milestoneServices } from "./project-milestone-fixtures";

import type { ProjectActionHandler } from "@/app/lib/project-actions/project-action-support.server";
import type { FormFields } from "../../actions/action-fixtures";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const { taskService } = milestoneServices;
const SUCCEEDED = { body: { ok: true }, status: 200 };
const INVALID = { body: { error: "invalidInput", ok: false }, status: 400 };
const BARE_MILESTONE = {
  ...MILESTONE,
  colorCustom: undefined,
  colorKey: undefined,
  iconKey: undefined,
  startAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  taskService.findMilestones.mockResolvedValue([MILESTONE]);
  taskService.findDependencies.mockResolvedValue([]);
});

async function run(
  handler: ProjectActionHandler,
  fields: FormFields,
): Promise<unknown> {
  const outcome = await outcomeOf(
    await handler(projectContext(milestoneServices, fields)),
  );

  return { body: outcome.body, status: outcome.status };
}

it("creates a milestone from the form with known color and symbol", async () => {
  const fields = {
    colorKey: " release ",
    customColor: " #aabbcc ",
    description: "First release",
    dueAt: "2026-06-30",
    iconKey: " rocket ",
    name: "Release",
    startAt: " ",
  };

  expect(await run(handleCreateMilestone, fields)).toEqual(SUCCEEDED);
  expect(taskService.createMilestone).toHaveBeenCalledWith(ACTOR, {
    colorCustom: "#aabbcc",
    colorKey: "release",
    description: "First release",
    dueAt: "2026-06-30",
    iconKey: "rocket",
    name: "Release",
    projectId: PROJECT_ID,
    startAt: null,
  });
});

it("creates a milestone without unknown color and symbol", async () => {
  const fields = { colorKey: "purple", iconKey: "unicorn", name: "Plain" };

  expect(await run(handleCreateMilestone, fields)).toEqual(SUCCEEDED);
  expect(taskService.createMilestone).toHaveBeenCalledWith(ACTOR, {
    colorCustom: null,
    colorKey: null,
    description: "",
    dueAt: null,
    iconKey: null,
    name: "Plain",
    projectId: PROJECT_ID,
    startAt: null,
  });
});

it("refuses to save a milestone with an unknown status", async () => {
  const fields = { milestoneId: MILESTONE.id, status: "paused" };

  expect(await run(handleSaveMilestone, fields)).toEqual(INVALID);
  expect(taskService.findMilestones).not.toHaveBeenCalled();
});

it("creates the milestone when the save names none", async () => {
  const fields = { milestoneId: "  ", name: "New", status: "open" };

  expect(await run(handleSaveMilestone, fields)).toEqual(SUCCEEDED);
  expect(taskService.createMilestone).toHaveBeenCalledWith(
    ACTOR,
    expect.objectContaining({ name: "New", projectId: PROJECT_ID }),
  );
  expect(taskService.updateMilestone).not.toHaveBeenCalled();
});

it("refuses to save a milestone the project does not have", async () => {
  const fields = { milestoneId: "milestone-9", status: "open" };

  expect(await run(handleSaveMilestone, fields)).toEqual(INVALID);
  expect(taskService.findMilestones).toHaveBeenCalledWith(ACTOR, [PROJECT_ID]);
  expect(taskService.updateMilestone).not.toHaveBeenCalled();
});

it.each<[string, FormFields]>([
  ["added links that are no JSON", { addLinks: "{oops" }],
  ["added links that are no list", { addLinks: '{"targetId":"m"}' }],
  ["an added link that is no object", { addLinks: "[1]" }],
  ["an added link that is null", { addLinks: "[null]" }],
  ["an added link without target", { addLinks: '[{"linkType":"blocks"}]' }],
  ["an added link with a numeric target", { addLinks: '[{"targetId":2}]' }],
  ["an added link without type", { addLinks: '[{"targetId":"m"}]' }],
  [
    "an added link with an unknown type",
    { addLinks: '[{"targetId":"m","linkType":"owns"}]' },
  ],
  ["removed links that are no JSON", { removeLinks: "[" }],
  ["removed links that are no list", { removeLinks: '"dep-1"' }],
  ["a removed link that is no text", { removeLinks: '["dep-1",2]' }],
])("refuses %s before changing anything", async (situation, links) => {
  const fields = { milestoneId: MILESTONE.id, status: "open", ...links };

  expect(await run(handleSaveMilestone, fields)).toEqual(INVALID);
  expect(taskService.updateMilestone).not.toHaveBeenCalled();
});

it("records why a dependency payload could not be read", async () => {
  const fields = {
    addLinks: "{oops",
    milestoneId: MILESTONE.id,
    status: "open",
  };

  await run(handleSaveMilestone, fields);

  expect(logCaughtError).toHaveBeenCalledWith(
    "project_milestone_actions",
    expect.any(SyntaxError),
  );
});

it("saves the submitted values of an existing milestone", async () => {
  const fields = {
    colorKey: "team",
    customColor: "#445566",
    description: "Changed",
    dueAt: "2026-09-30",
    iconKey: "flag",
    milestoneId: ` ${MILESTONE.id} `,
    name: "Renamed",
    startAt: "2026-07-01",
    status: "archived",
  };

  expect(await run(handleSaveMilestone, fields)).toEqual(SUCCEEDED);
  expect(taskService.updateMilestone).toHaveBeenCalledWith(
    ACTOR,
    MILESTONE.id,
    {
      colorCustom: "#445566",
      colorKey: "team",
      description: "Changed",
      dueAt: "2026-09-30",
      iconKey: "flag",
      name: "Renamed",
      startAt: "2026-07-01",
      status: "archived",
    },
  );
  expect(taskService.findDependencies).not.toHaveBeenCalled();
});

it("keeps the stored marker and start of a milestone the form leaves blank", async () => {
  const fields = {
    milestoneId: MILESTONE.id,
    name: "Beta",
    status: "completed",
  };

  expect(await run(handleSaveMilestone, fields)).toEqual(SUCCEEDED);
  expect(taskService.updateMilestone).toHaveBeenCalledWith(
    ACTOR,
    MILESTONE.id,
    {
      colorCustom: MILESTONE.colorCustom,
      colorKey: MILESTONE.colorKey,
      description: "",
      dueAt: null,
      iconKey: MILESTONE.iconKey,
      name: "Beta",
      startAt: MILESTONE.startAt,
      status: "completed",
    },
  );
});

it("clears the marker of a milestone that has none stored", async () => {
  taskService.findMilestones.mockResolvedValue([BARE_MILESTONE]);
  const fields = { milestoneId: MILESTONE.id, name: "Beta", status: "open" };

  expect(await run(handleSaveMilestone, fields)).toEqual(SUCCEEDED);
  expect(taskService.updateMilestone).toHaveBeenCalledWith(
    ACTOR,
    MILESTONE.id,
    expect.objectContaining({
      colorCustom: null,
      colorKey: null,
      iconKey: null,
      startAt: null,
    }),
  );
});

it("refuses to archive without a milestone", async () => {
  expect(await run(handleArchiveMilestone, { milestoneId: " " })).toEqual(
    INVALID,
  );
  expect(taskService.archiveMilestone).not.toHaveBeenCalled();
});

it("archives the named milestone", async () => {
  const fields = { milestoneId: ` ${MILESTONE.id} ` };

  expect(await run(handleArchiveMilestone, fields)).toEqual(SUCCEEDED);
  expect(taskService.archiveMilestone).toHaveBeenCalledWith(
    ACTOR,
    MILESTONE.id,
  );
});

it.each<[string, FormFields]>([
  ["an unknown milestone", { milestoneId: "milestone-9", status: "open" }],
  ["an unknown status", { milestoneId: MILESTONE.id, status: "done" }],
])("refuses a status change for %s", async (situation, fields) => {
  expect(await run(handleUpdateMilestoneStatus, fields)).toEqual(INVALID);
  expect(taskService.updateMilestone).not.toHaveBeenCalled();
});

it("changes only the status of a milestone", async () => {
  const fields = { milestoneId: MILESTONE.id, status: "completed" };

  expect(await run(handleUpdateMilestoneStatus, fields)).toEqual(SUCCEEDED);
  expect(taskService.updateMilestone).toHaveBeenCalledWith(
    ACTOR,
    MILESTONE.id,
    {
      colorCustom: MILESTONE.colorCustom,
      colorKey: MILESTONE.colorKey,
      description: MILESTONE.description,
      dueAt: MILESTONE.dueAt,
      iconKey: MILESTONE.iconKey,
      name: MILESTONE.name,
      startAt: MILESTONE.startAt,
      status: "completed",
    },
  );
});

it("changes the status of a milestone without marker", async () => {
  taskService.findMilestones.mockResolvedValue([BARE_MILESTONE]);
  const fields = { milestoneId: MILESTONE.id, status: "open" };

  expect(await run(handleUpdateMilestoneStatus, fields)).toEqual(SUCCEEDED);
  expect(taskService.updateMilestone).toHaveBeenCalledWith(
    ACTOR,
    MILESTONE.id,
    expect.objectContaining({
      colorCustom: null,
      colorKey: null,
      iconKey: null,
      status: "open",
    }),
  );
});
