import { expect, it, vi } from "vitest";

import { McpTicketWriteService } from "@/backend/service/mcp/ticket/McpTicketWriteService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";
import type { WorkItemDetail } from "@/definition/Task";

const TICKET = partial<WorkItemDetail>({
  id: "ticket",
  key: "PRJ-1",
  projectId: "project",
  projectName: "Project",
  parentId: null,
  parentKey: null,
  departmentIds: [],
  assigneeId: null,
  assigneeGroupId: null,
  milestoneId: null,
  createdBy: "user",
  createdAt: "2026-01-01 12:00:00",
  updatedAt: "2026-01-01 12:00:00",
  completedAt: null,
  startAt: null,
  dueAt: null,
  archivedAt: null,
});

it("creates a ticket with the first applicable workflow status and projects its current state", async () => {
  const create = vi.fn(async () => ({ id: "ticket" }));
  const assignLabel = vi.fn(async () => {});
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    person: async () => null,
    services: {
      projects: { getById: async () => ({}) },
      templates: {},
      attachments: { list: async () => [] },
      tasks: {
        create,
        assignLabel,
        findLabels: async () => [{ id: "label" }],
        findAllStatuses: async () => [
          { id: "later", projectId: "project", position: 2 },
          { id: "first", projectId: null, position: 1 },
        ],
        getById: async () => TICKET,
        findLabelsForWorkItems: async () => new Map(),
        findSubtasks: async () => [],
        findChecklistItems: async () => [],
        findLinks: async () => [],
      },
    },
  });
  const result = await new McpTicketWriteService().create(context, {
    projectId: "project",
    type: "task",
    title: "Title",
    labelIds: ["label"],
  });
  expect(result).toMatchObject({
    id: "ticket",
    key: "PRJ-1",
    createdAt: "2026-01-01T12:00:00Z",
  });
  expect(create).toHaveBeenCalledWith(
    context.actor,
    expect.objectContaining({
      projectId: "project",
      statusId: "first",
      type: "task",
      title: "Title",
    }),
  );
  expect(assignLabel).toHaveBeenCalledWith(context.actor, "ticket", "label");
});

it("rejects contradictory assignees before loading a project", async () => {
  const getById = vi.fn();
  const context = partial<McpTicketContext>({
    services: { projects: { getById } },
  });
  await expect(
    new McpTicketWriteService().create(context, {
      projectId: "project",
      type: "task",
      title: "Title",
      assignee: "person",
      assigneeGroupId: "group",
    }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(getById).not.toHaveBeenCalled();
});

it("rejects stale ticket edits before writing", async () => {
  const update = vi.fn();
  const ticket = { ...TICKET, title: "Current" };
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    ticket: async () => ticket,
    services: { tasks: { update } },
  });
  await expect(
    new McpTicketWriteService().patch(context, "PRJ-1", {
      title: "New",
      expected: { title: "Old" },
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(update).not.toHaveBeenCalled();
});

it("replaces ticket labels through the existing single-label operations", async () => {
  const assignLabel = vi.fn(async () => {});
  const unassignLabel = vi.fn(async () => {});
  const ticket = { ...TICKET, title: "Title" };
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    person: async () => null,
    ticket: async () => ticket,
    services: {
      attachments: { list: async () => [] },
      tasks: {
        findLabels: async () => [{ id: "new" }],
        findLabelsForWorkItems: async () =>
          new Map([["ticket", [{ id: "old" }]]]),
        findSubtasks: async () => [],
        findChecklistItems: async () => [],
        findLinks: async () => [],
        getById: async () => ticket,
        assignLabel,
        unassignLabel,
      },
    },
  });
  await new McpTicketWriteService().patch(context, "PRJ-1", {
    labelIds: ["new"],
  });
  expect(unassignLabel).toHaveBeenCalledWith(context.actor, "ticket", "old");
  expect(assignLabel).toHaveBeenCalledWith(context.actor, "ticket", "new");
});
