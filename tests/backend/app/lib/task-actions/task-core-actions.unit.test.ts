import { beforeEach, expect, it, vi } from "vitest";

import {
  handleArchiveTask,
  handleCreateTask,
  handleDeleteTask,
  handleMoveProject,
  handleMoveTask,
  handleRestoreTask,
  handleSetDepartment,
  handleSetTicketStatus,
  handleUpdateTask,
} from "@/app/lib/task-actions/task-core-actions.server";

import { ACTOR } from "../../actions/action-fixtures";
import { runTaskHandler } from "./task-action-fixtures";

import type { TaskActionHandler } from "@/app/lib/task-actions/task-action-support.server";
import type { FormFields } from "../../actions/action-fixtures";

const taskService = {
  archive: vi.fn(),
  archiveWithImpact: vi.fn(),
  create: vi.fn(),
  deletePermanently: vi.fn(),
  getById: vi.fn(),
  moveToProject: vi.fn(),
  restore: vi.fn(),
  restoreWithImpact: vi.fn(),
  setDepartment: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
  updateStatusAndOrder: vi.fn(),
};
const taskTemplateService = { createFromTemplate: vi.fn() };
const services = { taskService, taskTemplateService };

const NEW_TASK = {
  projectId: "project-1",
  type: "task",
  title: "Synthetic task",
  statusId: "status-1",
};

const EDITED_TASK = {
  id: "ticket-1",
  title: "Edited",
  statusId: "status-2",
  priority: "high",
  reporterId: "reporter-1",
};

beforeEach(() => {
  vi.resetAllMocks();
});

function nothingCalled(): void {
  for (const service of [
    ...Object.values(taskService),
    ...Object.values(taskTemplateService),
  ]) {
    expect(service).not.toHaveBeenCalled();
  }
}

async function run(
  handler: TaskActionHandler,
  fields: FormFields,
): ReturnType<typeof runTaskHandler> {
  return runTaskHandler(handler, services, fields);
}

it("creates a ticket with the optional fields left empty", async () => {
  taskService.create.mockResolvedValue({ key: "SYN-1" });

  const outcome = await run(handleCreateTask, NEW_TASK);

  expect(taskService.create).toHaveBeenCalledExactlyOnceWith(ACTOR, {
    assigneeGroupId: null,
    assigneeId: null,
    departmentId: null,
    description: "",
    dueAt: null,
    milestoneId: null,
    parentId: null,
    priority: "normal",
    projectId: "project-1",
    startAt: null,
    statusId: "status-1",
    title: "Synthetic task",
    type: "task",
  });
  expect(outcome.body).toEqual({
    ok: true,
    intent: "create-task",
    key: "SYN-1",
  });
});

it("creates a ticket from a template with every field of the form", async () => {
  taskTemplateService.createFromTemplate.mockResolvedValue({ key: "SYN-2" });

  const outcome = await run(handleCreateTask, {
    ...NEW_TASK,
    assigneeGroupId: "group-1",
    assigneeId: "user-1",
    departmentId: "department-1",
    description: "Text",
    dueAt: "2026-12-31",
    milestoneId: "milestone-1",
    parentId: "epic-1",
    priority: "urgent",
    startAt: "2026-01-01",
    templateId: "template-1",
  });

  expect(taskTemplateService.createFromTemplate).toHaveBeenCalledWith(
    ACTOR,
    "template-1",
    expect.objectContaining({
      assigneeGroupId: "group-1",
      description: "Text",
      priority: "urgent",
      startAt: "2026-01-01",
    }),
  );
  expect(taskService.create).not.toHaveBeenCalled();
  expect(outcome.body).toMatchObject({ ok: true, key: "SYN-2" });
});

it.each([
  ["no project", { projectId: undefined }],
  ["an unknown type", { type: "story" }],
  ["no title", { title: undefined }],
  ["no status", { statusId: undefined }],
])("refuses to create a ticket with %s", async (caseName, change) => {
  const fields = Object.fromEntries(
    Object.entries({ ...NEW_TASK, ...change }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

  const outcome = await run(handleCreateTask, fields);

  expect(outcome).toMatchObject({
    status: 400,
    body: { intent: "create-task", error: "invalidInput" },
  });
  nothingCalled();
});

it("updates a ticket and keeps an absent description", async () => {
  taskService.update.mockResolvedValue({ key: "SYN-3" });

  const outcome = await run(handleUpdateTask, EDITED_TASK);

  expect(taskService.update).toHaveBeenCalledExactlyOnceWith(
    ACTOR,
    "ticket-1",
    {
      assigneeGroupId: null,
      assigneeId: null,
      baseDescription: undefined,
      description: undefined,
      expected: undefined,
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: "high",
      reporterId: "reporter-1",
      startAt: null,
      statusId: "status-2",
      title: "Edited",
    },
  );
  expect(outcome.body).toEqual({
    ok: true,
    intent: "update-task",
    key: "SYN-3",
    ticket: { key: "SYN-3" },
  });
});

it("updates the description against the text it was written from", async () => {
  taskService.update.mockResolvedValue({ key: "SYN-3" });

  await run(handleUpdateTask, {
    ...EDITED_TASK,
    description: "New",
    baseDescription: "Old",
  });

  expect(taskService.update).toHaveBeenCalledWith(
    ACTOR,
    "ticket-1",
    expect.objectContaining({ baseDescription: "Old", description: "New" }),
  );
});

it("passes the displayed field snapshot to the service and refuses malformed snapshots", async () => {
  const snapshot = {
    title: "Original",
    statusId: "status-1",
    priority: "normal",
    assigneeId: null,
    assigneeGroupId: null,
    reporterId: "reporter-1",
    parentId: null,
    milestoneId: null,
    dueAt: null,
    startAt: null,
  };
  taskService.update.mockResolvedValue({ key: "SYN-3" });
  await run(handleUpdateTask, {
    ...EDITED_TASK,
    expectedSnapshot: JSON.stringify(snapshot),
  });
  expect(taskService.update).toHaveBeenCalledWith(
    ACTOR,
    "ticket-1",
    expect.objectContaining({ expected: snapshot }),
  );
  taskService.update.mockClear();
  const invalid = await run(handleUpdateTask, {
    ...EDITED_TASK,
    expectedSnapshot: "{}",
  });
  expect(invalid.status).toBe(400);
  expect(taskService.update).not.toHaveBeenCalled();
});

it("passes the displayed status to the conditional status update", async () => {
  taskService.updateStatus.mockResolvedValue({ key: "SYN-3" });
  await run(handleSetTicketStatus, {
    id: "ticket-1",
    statusId: "status-2",
    baseStatusId: "status-1",
  });
  expect(taskService.updateStatus).toHaveBeenCalledWith(ACTOR, "ticket-1", {
    baseStatusId: "status-1",
    statusId: "status-2",
  });
});

it.each([
  ["no id", { id: undefined }],
  ["no title", { title: undefined }],
  ["no status", { statusId: undefined }],
  ["an unknown priority", { priority: "later" }],
  ["no reporter", { reporterId: undefined }],
  ["a description without its base", { description: "New" }],
])("refuses to update a ticket with %s", async (caseName, change) => {
  const fields = Object.fromEntries(
    Object.entries({ ...EDITED_TASK, ...change }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

  const outcome = await run(handleUpdateTask, fields);

  expect(outcome.status).toBe(400);
  nothingCalled();
});

it("moves a ticket to a column and position", async () => {
  taskService.updateStatusAndOrder.mockResolvedValue({ key: "SYN-4" });

  const outcome = await run(handleMoveTask, {
    id: "ticket-1",
    statusId: "status-3",
    sortOrder: "2.5",
  });

  expect(taskService.updateStatusAndOrder).toHaveBeenCalledWith(
    ACTOR,
    "ticket-1",
    "status-3",
    2.5,
  );
  expect(outcome.body).toMatchObject({ intent: "move-task", key: "SYN-4" });
});

it.each<FormFields>([
  { statusId: "s", sortOrder: "1" },
  { id: "t", sortOrder: "1" },
  { id: "t", statusId: "s" },
])("refuses the move %j", async (fields) => {
  expect((await run(handleMoveTask, fields)).status).toBe(400);
  nothingCalled();
});

it("archives a ticket with its descendants by default", async () => {
  const outcome = await run(handleArchiveTask, { id: "ticket-1" });

  expect(taskService.archive).toHaveBeenCalledWith(
    ACTOR,
    "ticket-1",
    "include",
  );
  expect(outcome.body).toEqual({ ok: true, intent: "archive-task" });
});

it("archives a ticket and keeps its children", async () => {
  await run(handleArchiveTask, { id: "ticket-1", children: "keep" });

  expect(taskService.archive).toHaveBeenCalledWith(ACTOR, "ticket-1", "keep");
});

it.each([
  ["no id", { id: "" }],
  ["an unknown child handling", { id: "ticket-1", children: "drop" }],
])("refuses to archive with %s", async (caseName, fields) => {
  expect((await run(handleArchiveTask, fields)).status).toBe(400);
  nothingCalled();
});

it("restores an archived ticket", async () => {
  const outcome = await run(handleRestoreTask, { id: "ticket-1" });

  expect(taskService.restore).toHaveBeenCalledWith(ACTOR, "ticket-1");
  expect(outcome.body).toEqual({ ok: true, intent: "restore-task" });
});

it("refuses to restore without an id", async () => {
  expect((await run(handleRestoreTask, {})).status).toBe(400);
  nothingCalled();
});

it("deletes a ticket and returns to the local page it names", async () => {
  const outcome = await run(handleDeleteTask, {
    id: "ticket-1",
    children: "keep",
    redirectTo: "/projekte/p1",
  });

  expect(taskService.deletePermanently).toHaveBeenCalledWith(
    ACTOR,
    "ticket-1",
    "keep",
  );
  expect(outcome).toMatchObject({ status: 302, location: "/projekte/p1" });
});

it("deletes a ticket and returns to the board instead of a foreign page", async () => {
  const outcome = await run(handleDeleteTask, {
    id: "ticket-1",
    redirectTo: "//evil.invalid",
  });

  expect(outcome.location).toBe("/aufgaben");
});

it.each([
  ["no id", {}],
  ["an unknown child handling", { id: "ticket-1", children: "drop" }],
])("refuses to delete with %s", async (caseName, fields) => {
  expect((await run(handleDeleteTask, fields)).status).toBe(400);
  nothingCalled();
});

it("assigns a department and clears it with an empty value", async () => {
  await run(handleSetDepartment, { id: "ticket-1", departmentId: "d1" });
  const cleared = await run(handleSetDepartment, {
    id: "ticket-1",
    departmentId: "",
  });

  expect(taskService.setDepartment).toHaveBeenNthCalledWith(
    1,
    ACTOR,
    "ticket-1",
    "d1",
  );
  expect(taskService.setDepartment).toHaveBeenNthCalledWith(
    2,
    ACTOR,
    "ticket-1",
    "",
  );
  expect(cleared.body).toEqual({ ok: true, intent: "set-department" });
});

it("checks the displayed department and returns the updated board ticket", async () => {
  const ticket = { id: "ticket-1", key: "SYN-1" };
  taskService.getById.mockResolvedValue(ticket);
  const outcome = await run(handleSetDepartment, {
    id: "ticket-1",
    departmentId: "d1",
    expectedDepartmentId: "",
  });

  expect(taskService.setDepartment).toHaveBeenCalledWith(
    ACTOR,
    "ticket-1",
    "d1",
    null,
  );
  expect(outcome.body).toEqual({
    intent: "set-department",
    key: "SYN-1",
    ok: true,
    ticket,
  });
});

it("returns only the archived ticket and its affected parent to the board", async () => {
  const ticket = { id: "t1", key: "SYN-1", archivedAt: "today" };
  const parent = { id: "p1", key: "SYN-2" };
  taskService.getById.mockImplementation(
    async (actor: typeof ACTOR, id: string) => {
      expect(actor).toEqual(ACTOR);
      return id === "t1" ? ticket : parent;
    },
  );
  taskService.archiveWithImpact.mockResolvedValue({
    ticketIds: ["t1"],
    parentId: "p1",
    changedCount: 1,
  });
  const outcome = await run(handleArchiveTask, {
    boardLocal: "true",
    id: "t1",
  });
  expect(outcome.body).toEqual({
    intent: "archive-task",
    key: "SYN-1",
    ok: true,
    ticket,
    related: [parent],
  });
});

it.each<FormFields>([{ departmentId: "d1" }, { id: "ticket-1" }])(
  "refuses the department change %j",
  async (fields) => {
    expect((await run(handleSetDepartment, fields)).status).toBe(400);
    nothingCalled();
  },
);

it("moves a ticket into another project", async () => {
  taskService.moveToProject.mockResolvedValue({ key: "NEW-1" });

  const outcome = await run(handleMoveProject, {
    id: "ticket-1",
    targetProjectId: "project-2",
  });

  expect(taskService.moveToProject).toHaveBeenCalledWith(
    ACTOR,
    "ticket-1",
    "project-2",
  );
  expect(outcome.body).toEqual({
    ok: true,
    intent: "move-project",
    key: "NEW-1",
  });
});

it("passes the confirmed source snapshot when moving a ticket", async () => {
  taskService.moveToProject.mockResolvedValue({ key: "NEW-1" });
  const fields = {
    title: "Original",
    statusId: "status-1",
    priority: "normal",
    assigneeId: null,
    assigneeGroupId: null,
    reporterId: "reporter-1",
    parentId: null,
    milestoneId: null,
    dueAt: null,
    startAt: null,
  };
  const outcome = await run(handleMoveProject, {
    baseProjectId: "project-1",
    baseGithubIssueNumber: "123",
    expectedSnapshot: JSON.stringify(fields),
    id: "ticket-1",
    targetProjectId: "project-2",
  });
  expect(taskService.moveToProject).toHaveBeenCalledWith(
    ACTOR,
    "ticket-1",
    "project-2",
    { fields, githubIssueNumber: 123, projectId: "project-1" },
  );
  expect(outcome.body).toEqual({
    intent: "move-project",
    key: "NEW-1",
    ok: true,
  });
});

it.each<FormFields>([{ targetProjectId: "project-2" }, { id: "ticket-1" }])(
  "refuses the project move %j",
  async (fields) => {
    expect((await run(handleMoveProject, fields)).status).toBe(400);
    nothingCalled();
  },
);
