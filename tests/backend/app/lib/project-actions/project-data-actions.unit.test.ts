import { beforeEach, expect, it, vi } from "vitest";

import {
  handleAddMember,
  handleArchiveEvent,
  handleCreateEvent,
  handleCreateGoal,
  handleDeleteGoal,
  handleRemoveMember,
  handleSaveTemplate,
  handleSetTags,
  handleToggleGoal,
  handleUpdateDates,
  handleUpdateDescription,
  handleUpdateDetails,
  handleUpdateManager,
  handleUpdateMemberRole,
  handleUpdateName,
  handleUpdateStatus,
} from "@/app/lib/project-actions/project-data-actions.server";
import { MAXIMUM_PROJECT_DESCRIPTION_LENGTH } from "@/definition/Project";

import { ACTOR, outcomeOf } from "../../actions/action-fixtures";
import { PROJECT_ID, projectContext } from "./project-action-fixtures";

import type { ProjectActionHandler } from "@/app/lib/project-actions/project-action-support.server";
import type { FormFields } from "../../actions/action-fixtures";

const STORED_DETAILS = {
  description: "Stored description",
  managerId: "manager-1",
  name: "Stored name",
  notes: "Stored notes",
  progress: 40,
  startDate: "2026-01-01",
  status: "active",
  targetDate: "2026-12-31",
};

const projectService = {
  addMember: vi.fn(),
  archiveEvent: vi.fn(),
  createEvent: vi.fn(),
  createGoal: vi.fn(),
  deleteGoal: vi.fn(),
  findGoals: vi.fn(),
  getById: vi.fn(),
  removeMember: vi.fn(),
  saveTemplate: vi.fn(),
  setTags: vi.fn(),
  updateDetails: vi.fn(),
  updateGoal: vi.fn(),
  updateMemberRole: vi.fn(),
};
const services = { projectService };

beforeEach(() => {
  vi.resetAllMocks();
  projectService.getById.mockResolvedValue({
    ...STORED_DETAILS,
    id: PROJECT_ID,
  });
});

async function run(
  handler: ProjectActionHandler,
  fields: FormFields,
): Promise<unknown> {
  const outcome = await outcomeOf(
    await handler(projectContext(services, fields)),
  );

  return { body: outcome.body, status: outcome.status };
}

const SUCCEEDED = { body: { ok: true }, status: 200 };
const INVALID = { body: { error: "invalidInput", ok: false }, status: 400 };

it("saves the whole details form with blank optional fields as null", async () => {
  const result = await run(handleUpdateDetails, {
    description: "New description",
    managerId: "  ",
    name: "New name",
    notes: "New notes",
    startDate: " 2026-02-01 ",
    status: "paused",
    targetDate: "",
  });

  expect(result).toEqual(SUCCEEDED);
  expect(projectService.updateDetails).toHaveBeenCalledWith(ACTOR, PROJECT_ID, {
    ...STORED_DETAILS,
    description: "New description",
    managerId: null,
    name: "New name",
    notes: "New notes",
    startDate: "2026-02-01",
    status: "paused",
    targetDate: null,
  });
});

it.each<[string, ProjectActionHandler]>([
  ["details", handleUpdateDetails],
  ["status", handleUpdateStatus],
])("refuses %s with an unknown status", async (aspect, handler) => {
  expect(await run(handler, { name: "Name", status: "deleted" })).toEqual(
    INVALID,
  );
  expect(projectService.updateDetails).not.toHaveBeenCalled();
});

it("changes only the status", async () => {
  expect(await run(handleUpdateStatus, { status: "completed" })).toEqual(
    SUCCEEDED,
  );
  expect(projectService.updateDetails).toHaveBeenCalledWith(ACTOR, PROJECT_ID, {
    ...STORED_DETAILS,
    status: "completed",
  });
});

it("changes a description of the maximum length", async () => {
  const description = "d".repeat(MAXIMUM_PROJECT_DESCRIPTION_LENGTH);

  expect(await run(handleUpdateDescription, { description })).toEqual(
    SUCCEEDED,
  );
  expect(projectService.updateDetails).toHaveBeenCalledWith(ACTOR, PROJECT_ID, {
    ...STORED_DETAILS,
    description,
  });
});

it("refuses a description beyond the maximum length", async () => {
  const description = "d".repeat(MAXIMUM_PROJECT_DESCRIPTION_LENGTH + 1);

  expect(await run(handleUpdateDescription, { description })).toEqual(INVALID);
  expect(projectService.getById).not.toHaveBeenCalled();
});

it.each<[string, ProjectActionHandler, FormFields, object]>([
  [
    "manager",
    handleUpdateManager,
    { managerId: " user-2 " },
    { managerId: "user-2" },
  ],
  [
    "dates",
    handleUpdateDates,
    { startDate: "2026-03-01", targetDate: " " },
    { startDate: "2026-03-01", targetDate: null },
  ],
  ["name", handleUpdateName, { name: " Renamed " }, { name: " Renamed " }],
])("changes the %s of the project", async (aspect, handler, fields, change) => {
  expect(await run(handler, fields)).toEqual(SUCCEEDED);
  expect(projectService.updateDetails).toHaveBeenCalledWith(ACTOR, PROJECT_ID, {
    ...STORED_DETAILS,
    ...change,
  });
});

it("saves the project as template", async () => {
  expect(await run(handleSaveTemplate, {})).toEqual(SUCCEEDED);
  expect(projectService.saveTemplate).toHaveBeenCalledWith(ACTOR, PROJECT_ID);
});

it("adds a goal with the submitted title", async () => {
  expect(await run(handleCreateGoal, { title: "Ship" })).toEqual(SUCCEEDED);
  expect(projectService.createGoal).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    "Ship",
  );
});

it.each([
  [false, true],
  [true, false],
])("toggles a goal that is done=%s", async (isDone, nextIsDone) => {
  projectService.findGoals.mockResolvedValue([
    { id: "goal-0", isDone: false, title: "Other" },
    { id: "goal-1", isDone, title: "Ship" },
  ]);

  expect(await run(handleToggleGoal, { goalId: "goal-1" })).toEqual(SUCCEEDED);
  expect(projectService.updateGoal).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    "goal-1",
    { isDone: nextIsDone, title: "Ship" },
  );
});

it("refuses to toggle a goal the project does not have", async () => {
  projectService.findGoals.mockResolvedValue([]);

  expect(await run(handleToggleGoal, { goalId: "goal-9" })).toEqual(INVALID);
  expect(projectService.updateGoal).not.toHaveBeenCalled();
});

it("removes a goal", async () => {
  expect(await run(handleDeleteGoal, { goalId: "goal-1" })).toEqual(SUCCEEDED);
  expect(projectService.deleteGoal).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    "goal-1",
  );
});

it("replaces the tags with the comma separated list", async () => {
  expect(await run(handleSetTags, { tags: "alpha,beta" })).toEqual(SUCCEEDED);
  expect(projectService.setTags).toHaveBeenCalledWith(ACTOR, PROJECT_ID, [
    "alpha",
    "beta",
  ]);
});

it.each<[string, ProjectActionHandler, typeof projectService.addMember]>([
  ["adds", handleAddMember, projectService.addMember],
  ["updates", handleUpdateMemberRole, projectService.updateMemberRole],
])("%s a member with a known project role", async (verb, handler, call) => {
  expect(await run(handler, { role: "viewer", userId: "user-2" })).toEqual(
    SUCCEEDED,
  );
  expect(call).toHaveBeenCalledWith(ACTOR, PROJECT_ID, "user-2", "viewer");
});

it.each<[string, ProjectActionHandler, typeof projectService.addMember]>([
  ["adding", handleAddMember, projectService.addMember],
  ["updating", handleUpdateMemberRole, projectService.updateMemberRole],
])("refuses %s a member with an unknown role", async (verb, handler, call) => {
  expect(await run(handler, { role: "owner", userId: "user-2" })).toEqual(
    INVALID,
  );
  expect(call).not.toHaveBeenCalled();
});

it("removes a member", async () => {
  expect(await run(handleRemoveMember, { userId: "user-2" })).toEqual(
    SUCCEEDED,
  );
  expect(projectService.removeMember).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    "user-2",
  );
});

it("adds an event of the submitted type", async () => {
  const fields = {
    description: "Kick-off",
    eventDate: " 2026-05-01 ",
    eventTime: " 09:30 ",
    title: "Start",
    type: " meeting ",
  };

  expect(await run(handleCreateEvent, fields)).toEqual(SUCCEEDED);
  expect(projectService.createEvent).toHaveBeenCalledWith(ACTOR, PROJECT_ID, {
    description: "Kick-off",
    eventDate: "2026-05-01",
    eventTime: "09:30",
    title: "Start",
    type: "meeting",
  });
});

it("adds an untyped event as general event", async () => {
  expect(await run(handleCreateEvent, { title: "Start" })).toEqual(SUCCEEDED);
  expect(projectService.createEvent).toHaveBeenCalledWith(ACTOR, PROJECT_ID, {
    description: "",
    eventDate: "",
    eventTime: null,
    title: "Start",
    type: "general",
  });
});

it("archives an event", async () => {
  expect(await run(handleArchiveEvent, { eventId: "event-1" })).toEqual(
    SUCCEEDED,
  );
  expect(projectService.archiveEvent).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    "event-1",
  );
});
