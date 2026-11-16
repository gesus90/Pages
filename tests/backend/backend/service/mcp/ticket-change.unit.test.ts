import { expect, it, vi } from "vitest";

import {
  changesTicketFields,
  requireActiveTicket,
  requireExpected,
  requireLabels,
  resolveReferences,
  updateInput,
} from "@/backend/service/mcp/ticket/McpTicketChange";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";
import type { WorkItemDetail } from "@/definition/Task";

const TICKET = partial<WorkItemDetail>({
  id: "ticket",
  projectId: "project",
  title: "Old",
  description: "Body",
  statusId: "todo",
  priority: "normal",
  assigneeId: "person",
  assigneeGroupId: null,
  createdBy: "reporter",
  parentId: "parent",
  parentKey: "PAGE-1",
  milestoneId: null,
  startAt: "2030-01-01 00:00:00",
  dueAt: null,
  departmentIds: ["a", "b"],
  archivedAt: null,
});

it("checks expected fields with stable casing and unordered lists", async () => {
  const context = partial<McpTicketContext>({
    person: async (id: string) => ({
      username: id === "person" ? "Alice" : "Bob",
    }),
    services: {
      tasks: {
        findLabelsForWorkItems: async () =>
          new Map([["ticket", [{ id: "b" }, { id: "a" }]]]),
      },
    },
  });
  await expect(
    requireExpected(context, TICKET, {
      title: "Old",
      assignee: "alice",
      reporter: "BOB",
      parent: "page-1",
      departmentIds: ["b", "a"],
      labelIds: ["a", "b"],
      startAt: "2030-01-01",
    }),
  ).resolves.toBeUndefined();
  await expect(
    requireExpected(context, TICKET, { title: "changed" }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    requireExpected(context, TICKET, { departmentId: "a" }),
  ).rejects.toMatchObject({ code: "conflict" });
});

it("resolves changed people and parent before constructing the complete update", async () => {
  const context = partial<McpTicketContext>({
    requireAssignablePerson: vi.fn(async () => "new-person"),
    requireVisiblePerson: vi.fn(async () => ({ id: "new-reporter" })),
    ticket: vi.fn(async () => ({ id: "new-parent" })),
  });
  const request = {
    assignee: "Alice",
    reporter: "Bob",
    parent: "PAGE-2",
    title: "New",
    description: "Revised",
    milestoneId: null,
  };
  const references = await resolveReferences(context, TICKET, request);
  expect(references).toEqual({
    assigneeId: "new-person",
    assigneeGroupId: null,
    reporterId: "new-reporter",
    parentId: "new-parent",
  });
  expect(updateInput(TICKET, request, references)).toMatchObject({
    title: "New",
    description: "Revised",
    baseDescription: "Body",
    statusId: "todo",
    assigneeId: "new-person",
  });
  expect(changesTicketFields(request)).toBe(true);
  expect(changesTicketFields({ departmentIds: [] })).toBe(false);
  expect(
    await resolveReferences(context, TICKET, {
      assigneeGroupId: "group",
      parent: null,
    }),
  ).toMatchObject({
    assigneeId: null,
    assigneeGroupId: "group",
    parentId: null,
  });
});

it("rejects archived tickets and missing labels before writes", async () => {
  const findLabels = vi.fn(async () => [{ id: "known" }]);
  const context = partial<McpTicketContext>({
    services: { tasks: { findLabels } },
  });
  expect(() => requireActiveTicket(TICKET)).not.toThrow();
  expect(() => requireActiveTicket({ ...TICKET, archivedAt: "now" })).toThrow();
  await requireLabels(context, []);
  expect(findLabels).not.toHaveBeenCalled();
  await expect(requireLabels(context, ["known"])).resolves.toBeUndefined();
  await expect(requireLabels(context, ["unknown"])).rejects.toMatchObject({
    code: "not_found",
  });
});
