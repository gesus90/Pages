import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentTicketCreateInput } from "@/definition/AgentTickets";
import type { WorkItemDetail } from "@/definition/Task";
import type { AgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

const boundary = vi.hoisted(() => ({ directory: vi.fn() }));
vi.mock("@/backend/service/agents/AgentDirectoryService", () => ({
  readAgentDirectory: boundary.directory,
}));

import {
  resolveAgentTicketCreate,
  takeStatedTicketCreate,
} from "@/backend/service/agents/AgentTicketCreateContext";

const request: AgentTicketCreateInput = {
  operationId: "op",
  projectId: null,
  type: "task",
  title: "Task",
  description: "",
  statusId: null,
  parent: null,
  milestoneId: null,
};
const parent = partial<WorkItemDetail>({
  projectId: "project",
  milestoneId: "milestone",
  departmentIds: ["visible", "hidden"],
});
const eligible = vi.fn();
const departments = vi.fn();
const context = partial<AgentTaskContext>({
  actor: { id: "actor" },
  tasks: { findEligibleAssignees: eligible, departmentChoices: departments },
});

beforeEach(() => {
  vi.resetAllMocks();
  eligible.mockResolvedValue([{ id: "actor" }]);
  departments.mockResolvedValue({ available: [{ id: "visible" }] });
  boundary.directory.mockResolvedValue({
    departments: [{ id: "visible" }],
    people: [{ id: "person" }],
    groups: [{ id: "group" }],
  });
});

it("inherits visible parent values and assigns the eligible actor", async () => {
  expect(await resolveAgentTicketCreate(context, request, parent)).toEqual({
    projectId: "project",
    milestoneId: "milestone",
    departmentIds: ["visible"],
    assigneeId: "actor",
    assigneeGroupId: null,
  });
});

it("uses explicitly supplied project, departments and person", async () => {
  const stated = {
    ...request,
    projectId: "other",
    milestoneId: "other-milestone",
    departmentIds: ["visible"],
    assignee: { targetType: "person" as const, targetId: "person" },
  };
  expect(await resolveAgentTicketCreate(context, stated, parent)).toEqual({
    projectId: "other",
    milestoneId: "other-milestone",
    departmentIds: ["visible"],
    assigneeId: "person",
    assigneeGroupId: null,
  });
});

it("accepts group and explicit unassignment and does not invent an ineligible default", async () => {
  const base = { ...request, projectId: "project", departmentIds: [] };
  expect(
    (
      await resolveAgentTicketCreate(
        context,
        { ...base, assignee: { targetType: "group", targetId: "group" } },
        null,
      )
    ).assigneeGroupId,
  ).toBe("group");
  expect(
    (
      await resolveAgentTicketCreate(
        context,
        { ...base, assignee: { targetType: "none", targetId: null } },
        null,
      )
    ).assigneeId,
  ).toBeNull();
  eligible.mockResolvedValue([]);
  expect(
    (await resolveAgentTicketCreate(context, base, null)).assigneeId,
  ).toBeNull();
});

it("rejects missing projects and invisible departments or assignees", async () => {
  await expect(
    resolveAgentTicketCreate(context, request, null),
  ).rejects.toThrow();
  await expect(
    resolveAgentTicketCreate(
      context,
      { ...request, projectId: "project", departmentId: "hidden" },
      null,
    ),
  ).rejects.toThrow();
  await expect(
    resolveAgentTicketCreate(
      context,
      {
        ...request,
        projectId: "project",
        assignee: { targetType: "person", targetId: "hidden" },
      },
      null,
    ),
  ).rejects.toThrow();
  await expect(
    resolveAgentTicketCreate(
      context,
      {
        ...request,
        projectId: "project",
        assignee: { targetType: "group", targetId: "hidden" },
      },
      null,
    ),
  ).rejects.toThrow();
});

it("takes explicit values without inheriting or assigning for structured imports", () => {
  expect(() => takeStatedTicketCreate(request)).toThrow();
  expect(takeStatedTicketCreate({ ...request, projectId: "project" })).toEqual({
    projectId: "project",
    milestoneId: null,
    departmentIds: [],
    assigneeId: null,
    assigneeGroupId: null,
  });
});
