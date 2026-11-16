import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

const directory = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/agents/AgentDirectoryService", () => ({
  readAgentDirectory: directory,
}));

import {
  applyAgentMilestoneInitiative,
  applyAgentTicketDepartments,
  applyAgentTicketTags,
} from "@/backend/service/agents/AgentPlanningLinks";

const getById = vi.fn();
const findLabelsForWorkItems = vi.fn();
const findLabels = vi.fn();
const assignLabel = vi.fn();
const unassignLabel = vi.fn();
const setDepartments = vi.fn();
const link = vi.fn();
const unlink = vi.fn();
const context = partial<AgentTaskContext>({
  actor: { id: "user" },
  projects: { getById: vi.fn() },
  tasks: {
    getById,
    findLabelsForWorkItems,
    findLabels,
    assignLabel,
    unassignLabel,
    setDepartments,
    linkInitiativeToMilestone: link,
    unlinkInitiativeFromMilestone: unlink,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  getById.mockResolvedValue({
    id: "ticket",
    projectId: "project",
    departmentIds: ["old"],
  });
  findLabelsForWorkItems.mockResolvedValue(
    new Map([["ticket", [{ id: "old" }]]]),
  );
  findLabels.mockResolvedValue([{ id: "old" }, { id: "new" }]);
  directory.mockResolvedValue({ departments: [{ id: "new" }] });
  link.mockResolvedValue({ isChanged: true });
  unlink.mockResolvedValue({ isChanged: false });
});

it("replaces tags after checking the revision and catalog", async () => {
  expect(
    await applyAgentTicketTags(context, {
      ticketId: "ticket",
      tagIds: ["new"],
      expectedTagIds: ["old"],
    }),
  ).toMatchObject({ changed: true });
  expect(unassignLabel).toHaveBeenCalledWith(context.actor, "ticket", "old");
  expect(assignLabel).toHaveBeenCalledWith(context.actor, "ticket", "new");
});

it("rejects conflicts, duplicates and unknown tags before mutation", async () => {
  await expect(
    applyAgentTicketTags(context, {
      ticketId: "ticket",
      tagIds: ["new"],
      expectedTagIds: [],
    }),
  ).rejects.toThrow();
  await expect(
    applyAgentTicketTags(context, {
      ticketId: "ticket",
      tagIds: ["new", "new"],
      expectedTagIds: ["old"],
    }),
  ).rejects.toThrow();
  await expect(
    applyAgentTicketTags(context, {
      ticketId: "ticket",
      tagIds: ["missing"],
      expectedTagIds: ["old"],
    }),
  ).rejects.toThrow();
  expect(assignLabel).not.toHaveBeenCalled();
  expect(unassignLabel).not.toHaveBeenCalled();
});

it("allows retained hidden departments but rejects newly hidden ones", async () => {
  expect(
    await applyAgentTicketDepartments(context, {
      ticketId: "ticket",
      departmentIds: ["old", "new"],
      expectedDepartmentIds: ["old"],
    }),
  ).toMatchObject({ changed: true });
  expect(setDepartments).toHaveBeenCalledWith(context.actor, "ticket", [
    "old",
    "new",
  ]);
  await expect(
    applyAgentTicketDepartments(context, {
      ticketId: "ticket",
      departmentIds: ["hidden"],
      expectedDepartmentIds: ["old"],
    }),
  ).rejects.toThrow();
  await expect(
    applyAgentTicketDepartments(context, {
      ticketId: "ticket",
      departmentIds: ["new"],
      expectedDepartmentIds: [],
    }),
  ).rejects.toThrow();
});

it("links and unlinks milestones only in the matching project", async () => {
  expect(
    await applyAgentMilestoneInitiative(context, "milestone.initiative.add", {
      projectId: "project",
      milestoneId: "m",
      initiativeId: "ticket",
    }),
  ).toMatchObject({ changed: true, relatedId: "ticket" });
  expect(
    await applyAgentMilestoneInitiative(
      context,
      "milestone.initiative.remove",
      { projectId: "project", milestoneId: "m", initiativeId: "ticket" },
    ),
  ).toMatchObject({ changed: false });
  await expect(
    applyAgentMilestoneInitiative(context, "milestone.initiative.add", {
      projectId: "other",
      milestoneId: "m",
      initiativeId: "ticket",
    }),
  ).rejects.toThrow();
});
