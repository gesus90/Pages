import { expect, it, vi } from "vitest";

import { McpTicketReadService } from "@/backend/service/mcp/ticket/McpTicketReadService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";

it("orders applicable workflow statuses and hides assignment choices without write access", async () => {
  const findEligibleAssignees = vi.fn();
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    services: {
      projects: { getById: async () => ({}) },
      templates: { findVisible: async () => [] },
      tasks: {
        findAllStatuses: async () => [
          {
            id: "later",
            name: "Later",
            isDone: false,
            projectId: "project",
            position: 2,
          },
          {
            id: "first",
            name: "First",
            isDone: false,
            projectId: null,
            position: 1,
          },
          { id: "other", projectId: "other", position: 0 },
        ],
        findMilestones: async () => [],
        findLabels: async () => [],
        actionPermissions: async () => ({ canWrite: false }),
        findEligibleAssignees,
      },
    },
  });
  await expect(
    new McpTicketReadService().options(context, "project"),
  ).resolves.toMatchObject({
    statuses: [{ id: "first" }, { id: "later" }],
    people: [],
    groups: [],
    departments: [],
  });
  expect(findEligibleAssignees).not.toHaveBeenCalled();
});

it("refuses archived searches without the archive right", async () => {
  const findAll = vi.fn();
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    services: {
      projects: { getById: async () => ({}) },
      tasks: { canArchive: async () => false, findAll },
    },
  });
  await expect(
    new McpTicketReadService().search(
      context,
      partial({ projectId: "project", archived: "1", offset: 0, limit: 10 }),
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(findAll).not.toHaveBeenCalled();
});

it("validates filters, orders search results and paginates before reading labels", async () => {
  const first = {
    id: "first",
    key: "P-1",
    number: 1,
    assigneeId: null,
    assigneeGroupId: null,
    parentKey: null,
    milestoneId: null,
    archivedAt: null,
  };
  const second = { ...first, id: "second", key: "P-2", number: 2 };
  const findLabelsForWorkItems = vi.fn(async () => new Map());
  const findAll = vi.fn(async () => [second, first]);
  const context = partial<McpTicketContext>({
    actor: { id: "user" },
    person: async () => null,
    services: {
      projects: { getById: async () => ({}) },
      tasks: {
        findAllStatuses: async () => [
          { id: "status", projectId: "project", position: 0 },
        ],
        findAll,
        findLabelsForWorkItems,
      },
    },
  });
  const service = new McpTicketReadService();
  const result = await service.search(
    context,
    partial({ projectId: "project", statusId: "status", offset: 0, limit: 1 }),
  );
  expect(result).toMatchObject({ total: 2, tickets: [{ key: "P-1" }] });
  expect(findLabelsForWorkItems).toHaveBeenCalledWith(["first"]);
  await expect(
    service.search(
      context,
      partial({
        projectId: "project",
        statusId: "missing",
        offset: 0,
        limit: 1,
      }),
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(findAll).toHaveBeenCalledTimes(1);
});
