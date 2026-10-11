import { expect, it, vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { AgentPlanningReadService } from "@/backend/service/agents/AgentPlanningReadService";
import { TaskService } from "@/backend/service/TaskService";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import {
  planningIdentity,
  planningMilestone,
  planningTicket,
  useAgentPlanningHarness,
} from "../helpers/agent-planning";
import { createWorkItem } from "../helpers/factories";
import { fieldStatus } from "../helpers/task-fields";

const setup = useAgentPlanningHarness();

it("reads IDs, keys and addresses, lists only applicable statuses and excludes people and integration metadata", async () => {
  const run = await setup();
  await run.planning.tickets.apply(
    planningIdentity,
    "ticket.create",
    planningTicket(),
  );
  const item = (await run.repository.findAll())[0];
  if (!item) throw new Error("Expected ticket.");
  vi.spyOn(TaskService.prototype, "findAllStatuses").mockResolvedValue([
    fieldStatus(),
    fieldStatus({ id: "own", projectId: "p1" }),
    fieldStatus({ id: "foreign", projectId: "p2" }),
  ]);
  const byId = await run.planning.reads.readTicket(planningIdentity, {
    ticketId: item.id,
  });
  for (const ticketId of [
    item.key,
    `/aufgaben/${item.key}`,
    `https://pages.invalid/tasks/${item.key}`,
  ])
    expect(
      await run.planning.reads.readTicket(planningIdentity, { ticketId }),
    ).toEqual(byId);
  expect(byId).toMatchObject({
    result: {
      id: item.id,
      key: item.key,
      title: "Original",
      isArchived: false,
      statuses: [
        { id: "status-done", name: "Done", isDone: true },
        { id: "own", name: "Done", isDone: true },
      ],
    },
  });
  expect(JSON.stringify(byId)).not.toMatch(
    /createdBy|assignee|reporter|github|department|password/,
  );
  vi.spyOn(TaskService.prototype, "getById").mockResolvedValue(
    createWorkItem({ archivedAt: "2026-01-01" }),
  );
  expect(
    await run.planning.reads.readTicket(planningIdentity, {
      ticketId: item.id,
    }),
  ).toMatchObject({ result: { isArchived: true } });
});

it("describes milestone fields and dependencies without exposing extra storage columns", async () => {
  const run = await setup();
  await run.planning.milestones.apply(
    planningIdentity,
    "milestone.create",
    planningMilestone(),
  );
  await run.planning.milestones.apply(
    planningIdentity,
    "milestone.create",
    planningMilestone({ operationId: "second", name: "Second" }),
  );
  const [source, target] = await run.repository.findMilestonesByProjectIds([
    "p1",
  ]);
  if (!source || !target) throw new Error("Expected milestone pair.");
  await run.planning.milestones.apply(
    planningIdentity,
    "milestone.dependency.add",
    {
      operationId: "link",
      projectId: "p1",
      sourceId: source.id,
      targetId: target.id,
      linkType: "blocks",
    },
  );
  const result = await run.planning.reads.readMilestones(
    { ...planningIdentity, userId: "reader" },
    { projectId: "p1" },
  );
  expect(result).toMatchObject({
    apiVersion: "1",
    result: {
      projectId: "p1",
      milestones: [
        {
          id: source.id,
          name: source.name,
          status: "open",
          startAt: null,
          dueAt: null,
        },
        {
          id: target.id,
          name: target.name,
          status: "open",
          startAt: null,
          dueAt: null,
        },
      ],
      dependencies: [
        { sourceId: source.id, targetId: target.id, linkType: "blocks" },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /createdAt|updatedAt|archivedAt|colorKey|completedAt/,
  );
  await expect(
    run.planning.reads.readMilestones(
      { ...planningIdentity, userId: "reader" },
      { projectId: "p2" },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it.each(["ticket", "milestones"] as const)(
  "rejects missing, inactive and password-gated accounts for %s",
  async (kind) => {
    const run = await setup();
    const read = (userId: string) =>
      kind === "ticket"
        ? run.planning.reads.readTicket(
            { ...planningIdentity, userId },
            { ticketId: "missing" },
          )
        : run.planning.reads.readMilestones(
            { ...planningIdentity, userId },
            { projectId: "p1" },
          );
    await expect(read("missing")).rejects.toMatchObject({ status: 401 });
    await run.database.execute(
      "UPDATE users SET is_active = 0 WHERE id = 'owner';",
    );
    await expect(read("owner")).rejects.toMatchObject({ status: 401 });
    await run.database.execute(
      "UPDATE users SET is_active = 1, must_change_password = 1 WHERE id = 'owner';",
    );
    await expect(read("owner")).rejects.toMatchObject({ status: 401 });
  },
);

it("enforces the UTF-8 limit for both read responses and preserves unexpected storage failures", async () => {
  const run = await setup();
  const reads = new AgentPlanningReadService({
    database: run.database,
    users: { getById: (id) => run.users.findById(id) },
  });
  vi.spyOn(TaskService.prototype, "getById").mockResolvedValue(
    createWorkItem({
      description: "é".repeat(PAGES_AGENT_LIMITS.responseBytes / 2),
    }),
  );
  await expect(
    reads.readTicket(planningIdentity, { ticketId: "item" }),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  vi.spyOn(
    TaskRepository.prototype,
    "findMilestonesByProjectIds",
  ).mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(
    reads.readMilestones(planningIdentity, { projectId: "p1" }),
  ).rejects.toThrow("storage unavailable");
  await run.planning.milestones.apply(
    planningIdentity,
    "milestone.create",
    planningMilestone({
      description: "é".repeat(PAGES_AGENT_LIMITS.responseBytes / 2),
    }),
  );
  await expect(
    reads.readMilestones(planningIdentity, { projectId: "p1" }),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
});
