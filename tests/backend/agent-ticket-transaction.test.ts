import { expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentTicketTransaction } from "@/backend/service/agents/AgentTicketTransaction";
import { readAgentTicketCreate } from "@/backend/service/agents/AgentTicketValidation";
import { TaskService } from "@/backend/service/TaskService";

import {
  planningIdentity,
  planningTicket,
  useAgentPlanningHarness,
} from "../helpers/agent-planning";
import { fieldStatus } from "../helpers/task-fields";

const setup = useAgentPlanningHarness();

it("creates within an existing transaction, returns a replay and announces only after the caller commits", async () => {
  const run = await setup();
  const request = readAgentTicketCreate(planningTicket());
  const outcome = await run.database.transaction(async (transaction) => {
    const created = await run.planning.tickets.createWithin(
      transaction,
      "owner",
      request,
    );
    const replay = await run.planning.tickets.createWithin(
      transaction,
      "owner",
      request,
    );
    expect(replay).toMatchObject({
      result: created.result,
      published: null,
      event: null,
    });
    expect(run.listener).not.toHaveBeenCalled();
    expect(run.publish).not.toHaveBeenCalled();
    return created;
  });
  run.planning.announcer.announce(outcome);
  expect(run.listener).toHaveBeenCalledExactlyOnceWith({
    type: "ticket.created",
    id: outcome.result.ticketId,
  });
  expect(run.publish).toHaveBeenCalledOnce();
  expect(await run.database.query("SELECT COUNT(*) FROM work_items;")).toEqual([
    [1],
  ]);
});

it.each([
  ["missing", null],
  ["owner", "UPDATE users SET is_active = 0 WHERE id = 'owner';"],
  ["owner", "UPDATE users SET must_change_password = 1 WHERE id = 'owner';"],
] as const)(
  "rejects invalid accounts in regular and caller-held transactions: %s %s",
  async (userId, statement) => {
    const run = await setup();
    if (statement) await run.database.execute(statement);
    await expect(
      run.planning.tickets.apply(
        { ...planningIdentity, userId },
        "ticket.create",
        planningTicket(),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      run.database.transaction((transaction) =>
        run.planning.tickets.createWithin(
          transaction,
          userId,
          readAgentTicketCreate(planningTicket()),
        ),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
    ).toEqual([[0]]);
    expect(run.listener).not.toHaveBeenCalled();
  },
);

it("rolls back an inserted ticket when its operation result cannot be stored", async () => {
  const run = await setup();
  const failure = new Error("operation storage unavailable");
  vi.spyOn(
    AgentOperationKeyRepository.prototype,
    "insert",
  ).mockRejectedValueOnce(failure);
  await expect(
    run.planning.tickets.apply(
      planningIdentity,
      "ticket.create",
      planningTicket(),
    ),
  ).rejects.toBe(failure);
  expect(await run.database.query("SELECT COUNT(*) FROM work_items;")).toEqual([
    [0],
  ]);
  expect(
    await run.database.query("SELECT COUNT(*) FROM work_item_history;"),
  ).toEqual([[0]]);
  expect(
    await run.database.query(
      "SELECT last_number FROM project_keys WHERE project_id = 'p1';",
    ),
  ).toEqual([[0]]);
  expect(run.publish).not.toHaveBeenCalled();
  expect(run.listener).not.toHaveBeenCalled();
});

it.each([
  [
    "first open",
    [
      fieldStatus({ id: "foreign", projectId: "p2" }),
      fieldStatus({ id: "open", projectId: "p1", isDone: false, key: "todo" }),
    ],
    "open",
  ],
  ["first completed", [fieldStatus()], "status-done"],
  ["no status", [], ""],
] as const)(
  "uses the %s fallback when a project has no backlog",
  async (_label, statuses, expected) => {
    const run = await setup();
    vi.spyOn(TaskService.prototype, "findAllStatuses").mockResolvedValue([
      ...statuses,
    ]);
    const create = vi.spyOn(TaskService.prototype, "create");
    if (expected !== "status-done") {
      await expect(
        run.planning.tickets.apply(
          planningIdentity,
          "ticket.create",
          planningTicket(),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } else {
      expect(
        await run.planning.tickets.apply(
          planningIdentity,
          "ticket.create",
          planningTicket(),
        ),
      ).toMatchObject({ result: { statusId: expected } });
    }
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "owner" }),
      expect.objectContaining({ statusId: expected }),
    );
  },
);

it("translates a caller-held transaction failure without replacing unexpected failures", async () => {
  const run = await setup();
  const runner = new AgentTicketTransaction(run.database);
  const failure = new Error("caller failure");
  await expect(
    run.database.transaction((transaction) =>
      runner.runWithin(transaction, {
        userId: "owner",
        operation: "test",
        request: { operationId: "test" },
        needsWriteRight: false,
        revisit: vi.fn(),
        work: vi.fn().mockRejectedValue(failure),
      }),
    ),
  ).rejects.toBe(failure);
  expect(
    await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
  ).toEqual([[0]]);
});
