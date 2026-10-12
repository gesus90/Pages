import { expect, it, vi } from "vitest";

import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { readAgentDirectory } from "@/backend/service/agents/AgentDirectoryService";
import { applyAgentPlanningExtension } from "@/backend/service/agents/AgentPlanningExtensions";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

import {
  createDatabase,
  createUser,
  createWorkItem,
} from "../helpers/factories";
import { fieldMilestone } from "../helpers/task-fields";

import type { WorkItemDetail } from "@/definition/Task";

vi.mock("@/backend/service/agents/AgentDirectoryService", () => ({
  readAgentDirectory: vi.fn(),
}));

function setup(overrides: Partial<WorkItemDetail> = {}) {
  const context = createAgentTaskContext(createDatabase(), createUser());
  const ticket = createWorkItem({ assigneeId: null, ...overrides });
  const methods = {
    byId: vi.spyOn(context.tasks, "getById").mockResolvedValue(ticket),
    byKey: vi.spyOn(context.tasks, "getByKey").mockResolvedValue(ticket),
    update: vi.spyOn(context.tasks, "update").mockResolvedValue(ticket),
    department: vi
      .spyOn(context.tasks, "setDepartment")
      .mockResolvedValue(undefined),
    archive: vi.spyOn(context.tasks, "archive").mockResolvedValue(undefined),
    confirmation: vi
      .spyOn(UserSettingsRepository.prototype, "findByUserId")
      .mockResolvedValue(null),
  };
  vi.mocked(readAgentDirectory).mockResolvedValue({
    people: [
      { id: "person", displayName: "Person", departments: [], groups: [] },
    ],
    groups: [{ id: "group", name: "Group", memberIds: ["person"] }],
    departments: [{ id: "department", name: "Department" }],
  });
  return { context, ticket, methods };
}

it.each([
  ["person", "person", { assigneeId: "person", assigneeGroupId: null }],
  ["group", "group", { assigneeId: null, assigneeGroupId: "group" }],
  ["none", null, { assigneeId: null, assigneeGroupId: null }],
] as const)(
  "assigns a visible %s while preserving the unrelated ticket fields",
  async (targetType, targetId, assignment) => {
    const run = setup();
    await expect(
      applyAgentPlanningExtension(run.context, "ticket.setAssignee", {
        ticketId: run.ticket.id,
        targetType,
        targetId,
        expectedAssigneeId: null,
        expectedAssigneeGroupId: null,
      }),
    ).resolves.toEqual({
      id: run.ticket.id,
      projectId: run.ticket.projectId,
      changed: true,
    });
    expect(run.methods.update).toHaveBeenCalledExactlyOnceWith(
      run.context.actor,
      run.ticket.id,
      {
        title: run.ticket.title,
        statusId: run.ticket.statusId,
        priority: run.ticket.priority,
        reporterId: run.ticket.createdBy,
        parentId: run.ticket.parentId,
        milestoneId: run.ticket.milestoneId,
        dueAt: run.ticket.dueAt,
        startAt: run.ticket.startAt,
        ...assignment,
      },
    );
  },
);

it.each([
  [{ expectedAssigneeId: "stale" }, "CONFLICT"],
  [{ expectedAssigneeGroupId: "stale" }, "CONFLICT"],
  [{ targetType: "unsupported" }, "INVALID_REQUEST"],
  [{ targetType: "none", targetId: "person" }, "INVALID_REQUEST"],
  [{ targetType: "person", targetId: "hidden" }, "NOT_FOUND"],
  [{ targetType: "group", targetId: "hidden" }, "NOT_FOUND"],
] as const)(
  "refuses invalid or stale assignee selection %j",
  async (overrides, code) => {
    const run = setup();
    await expect(
      applyAgentPlanningExtension(run.context, "ticket.setAssignee", {
        ticketId: run.ticket.id,
        targetType: "person",
        targetId: "person",
        expectedAssigneeId: null,
        expectedAssigneeGroupId: null,
        ...overrides,
      }),
    ).rejects.toMatchObject({ code });
    expect(run.methods.update).not.toHaveBeenCalled();
  },
);

it("can replace an assignment whose previous person and group are no longer visible", async () => {
  const run = setup({
    assigneeId: "hidden-person",
    assigneeGroupId: "hidden-group",
  });
  await applyAgentPlanningExtension(run.context, "ticket.setAssignee", {
    ticketId: run.ticket.id,
    targetType: "none",
    targetId: null,
    expectedAssigneeId: null,
    expectedAssigneeGroupId: null,
  });
  expect(run.methods.update).toHaveBeenCalledWith(
    run.context.actor,
    run.ticket.id,
    expect.objectContaining({ assigneeId: null, assigneeGroupId: null }),
  );
});

it.each(["department", null])(
  "changes the department to %j using the dedicated service",
  async (targetId) => {
    const run = setup();
    await expect(
      applyAgentPlanningExtension(run.context, "ticket.setAssignee", {
        ticketId: run.ticket.id,
        targetType: "department",
        targetId,
        expectedDepartmentId: null,
      }),
    ).resolves.toMatchObject({ changed: targetId !== null });
    expect(run.methods.department).toHaveBeenCalledExactlyOnceWith(
      run.context.actor,
      run.ticket.id,
      targetId,
    );
    expect(run.methods.update).not.toHaveBeenCalled();
  },
);

it.each([
  [{ expectedDepartmentId: "stale", targetId: "department" }, "CONFLICT"],
  [{ expectedDepartmentId: null, targetId: "hidden" }, "NOT_FOUND"],
] as const)(
  "refuses stale or hidden department selections %j",
  async (parameters, code) => {
    const run = setup();
    await expect(
      applyAgentPlanningExtension(run.context, "ticket.setAssignee", {
        ticketId: run.ticket.id,
        targetType: "department",
        ...parameters,
      }),
    ).rejects.toMatchObject({ code });
    expect(run.methods.department).not.toHaveBeenCalled();
  },
);

it.each(["milestone", null])(
  "sets or clears a milestone %j after comparing the previous selection",
  async (milestoneId) => {
    const run = setup({ milestoneId: "previous" });
    await applyAgentPlanningExtension(run.context, "ticket.assignMilestone", {
      ticketId: run.ticket.id,
      expectedMilestoneId: "previous",
      milestoneId,
    });
    expect(run.methods.update).toHaveBeenCalledWith(
      run.context.actor,
      run.ticket.id,
      expect.objectContaining({ milestoneId }),
    );
  },
);

it("refuses a stale milestone selection without updating the ticket", async () => {
  const run = setup({ milestoneId: "previous" });
  await expect(
    applyAgentPlanningExtension(run.context, "ticket.assignMilestone", {
      ticketId: run.ticket.id,
      expectedMilestoneId: null,
      milestoneId: "next",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(run.methods.update).not.toHaveBeenCalled();
});

it("resolves a ticket key before recursively archiving and reports the complete active subtree count", async () => {
  const run = setup();
  vi.spyOn(run.context.tasks, "describeDescendants").mockResolvedValue({
    active: { initiative: 0, epic: 1, task: 2, subtask: 3 },
    all: { initiative: 0, epic: 1, task: 2, subtask: 3 },
    canArchive: true,
  });
  await expect(
    applyAgentPlanningExtension(run.context, "ticket.delete", {
      ticketId: run.ticket.key,
      confirmation: "LÖSCHEN",
    }),
  ).resolves.toMatchObject({
    affectedCount: 7,
    recursive: true,
    disposition: "trash",
  });
  expect(run.methods.byKey).toHaveBeenCalledExactlyOnceWith(
    run.context.actor,
    run.ticket.key,
  );
  expect(run.methods.archive).toHaveBeenCalledExactlyOnceWith(
    run.context.actor,
    run.ticket.id,
    "include",
  );
});

it("archives a milestone of the visible project through the service that checks the right", async () => {
  const run = setup();
  vi.spyOn(run.context.projects, "getById").mockResolvedValue({
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    id: "project-1",
    name: "Project",
    description: "",
    departments: [],
    parentId: null,
    status: "active",
    progress: 0,
    placeholderColor: "#FCE3D3",
    hasIcon: false,
    managerId: null,
    managerName: null,
    startDate: null,
    targetDate: null,
    notes: "",
  });
  vi.spyOn(run.context.tasks, "findMilestones").mockResolvedValue([
    fieldMilestone(),
  ]);
  const archive = vi
    .spyOn(run.context.tasks, "archiveMilestone")
    .mockResolvedValue(undefined);
  await expect(
    applyAgentPlanningExtension(run.context, "milestone.delete", {
      projectId: "project-1",
      milestoneId: fieldMilestone().id,
      confirmation: "LÖSCHEN",
    }),
  ).resolves.toEqual({
    id: fieldMilestone().id,
    projectId: "project-1",
    changed: true,
    affectedCount: 1,
    disposition: "trash",
  });
  expect(archive).toHaveBeenCalledExactlyOnceWith(
    run.context.actor,
    fieldMilestone().id,
  );
});

it("does not delete a milestone absent from the visible project", async () => {
  const run = setup();
  vi.spyOn(run.context.projects, "getById").mockResolvedValue({
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    id: "project-1",
    name: "Project",
    description: "",
    departments: [],
    parentId: null,
    status: "active",
    progress: 0,
    placeholderColor: "#FCE3D3",
    hasIcon: false,
    managerId: null,
    managerName: null,
    startDate: null,
    targetDate: null,
    notes: "",
  });
  vi.spyOn(run.context.tasks, "findMilestones").mockResolvedValue([
    fieldMilestone(),
  ]);
  const remove = vi
    .spyOn(run.context.tasks, "archiveMilestone")
    .mockResolvedValue(undefined);
  await expect(
    applyAgentPlanningExtension(run.context, "milestone.delete", {
      projectId: "project-1",
      milestoneId: "hidden",
      confirmation: "LÖSCHEN",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(remove).not.toHaveBeenCalled();
});
