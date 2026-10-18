import { expect, it, vi } from "vitest";

import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";

import { TICKET, TICKET_ACTOR } from "./page55-ticket-fixture";

it("lists each ticket with the key and done flag of its current workflow status", async () => {
  const findAll = vi.fn(async () => [
    TICKET,
    {
      ...TICKET,
      id: "done-id",
      key: "SYN-56",
      statusId: "done",
      statusKey: "done",
      statusName: "Done",
      isDone: true,
    },
  ]);
  const tasks = new AgentPlanTasks(
    { findAll, getById: vi.fn(), findChecklistItems: vi.fn() },
    { getById: async () => TICKET_ACTOR },
  );
  expect(await tasks.list("owner", "project")).toEqual([
    {
      id: "ticket-id",
      key: "SYN-55",
      title: "Synthetic review",
      type: "task",
      parentId: null,
      statusKey: "todo",
      statusName: "Todo",
      isDone: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    },
    {
      id: "done-id",
      key: "SYN-56",
      title: "Synthetic review",
      type: "task",
      parentId: null,
      statusKey: "done",
      statusName: "Done",
      isDone: true,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    },
  ]);
  expect(findAll).toHaveBeenCalledWith(TICKET_ACTOR, {
    projectIds: ["project"],
    archived: "active",
  });
});
