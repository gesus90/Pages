import { expect, it, vi } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

import {
  planningIdentity,
  planningTicket,
  useAgentPlanningHarness,
} from "../helpers/agent-planning";

import type { WorkItemDetail } from "@/definition/Task";

const setup = useAgentPlanningHarness();

async function createTicket(
  run: Awaited<ReturnType<ReturnType<typeof useAgentPlanningHarness>>>,
  overrides: Record<string, unknown> = {},
): Promise<WorkItemDetail> {
  const response = await run.planning.tickets.apply(
    planningIdentity,
    "ticket.create",
    planningTicket(overrides),
  );
  if (!("ticketId" in response.result))
    throw new Error("Expected ticket creation result.");
  return run.context.tasks.getById(run.owner, response.result.ticketId);
}

it("creates exactly one local ticket and replays its key without another counter, history, event or publication", async () => {
  const run = await setup();
  const input = planningTicket();
  const first = await run.planning.tickets.apply(
    planningIdentity,
    "ticket.create",
    input,
  );
  expect(first).toMatchObject({
    apiVersion: "1",
    result: {
      key: "PAGE-1",
      link: "/tasks/PAGE-1",
      statusId: "status-backlog",
    },
  });
  expect(
    await run.planning.tickets.apply(planningIdentity, "ticket.create", input),
  ).toEqual(first);
  expect(
    await run.database.query(
      "SELECT key, title, description, sort_order FROM work_items;",
    ),
  ).toEqual([["PAGE-1", "Original", "Original body", 1]]);
  expect(
    await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
  ).toEqual([[1]]);
  expect(
    await run.database.query("SELECT COUNT(*) FROM work_item_history;"),
  ).toEqual([[1]]);
  expect(run.listener).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ type: "ticket.created" }),
  );
  expect(run.publish).toHaveBeenCalledOnce();
  expect(run.invalidate).toHaveBeenCalledOnce();
  await expect(
    run.planning.tickets.apply(planningIdentity, "ticket.create", {
      ...input,
      title: "Other",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    run.planning.tickets.apply(planningIdentity, "ticket.setTitle", {
      operationId: "ticket-create",
      ticketId: "PAGE-1",
      expectedTitle: "Original",
      title: "New",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it.each(
  (
    [
      ["ticket.setTitle", "title", "expectedTitle", "title", "Original", "New"],
      [
        "ticket.setDescription",
        "description",
        "expectedDescription",
        "description",
        "Original body",
        "New body",
      ],
      [
        "ticket.setStatus",
        "statusId",
        "expectedStatusId",
        "statusId",
        "status-backlog",
        "status-done",
      ],
    ] as const
  ).map(([operation, field, expectedKey, valueKey, expected, value]) => ({
    operation,
    field,
    expectedKey,
    valueKey,
    expected,
    value,
  })),
)(
  "changes only the addressed field with $operation and leaves other tickets in place",
  async ({ operation, field, expectedKey, valueKey, expected, value }) => {
    const run = await setup();
    const epic = await createTicket(run, { operationId: "epic", type: "epic" });
    await run.repository.insertMilestone({
      id: "release",
      projectId: "p1",
      name: "Release",
      description: "Plan",
      dueAt: "2026-02-01",
    });
    const item = await createTicket(run, {
      parentId: epic.key,
      milestoneId: "release",
    });
    const sibling = await createTicket(run, {
      operationId: "sibling",
      title: "Sibling",
    });
    const before = await run.context.tasks.getById(run.owner, item.id);
    const siblingBefore = await run.context.tasks.getById(
      run.owner,
      sibling.id,
    );
    run.publish.mockClear();
    run.listener.mockClear();
    run.invalidate.mockClear();
    const parameters = {
      operationId: "change",
      ticketId: `/tasks/${item.key}`,
      [expectedKey]: expected,
      [valueKey]: value,
    };
    const first = await run.planning.tickets.apply(
      planningIdentity,
      operation,
      parameters,
    );
    expect(first).toMatchObject({
      result: { ticketId: item.id, changed: true },
    });
    const after = await run.context.tasks.getById(run.owner, item.id);
    expect(after).toMatchObject({
      ...before,
      [field]: value,
      updatedAt: after.updatedAt,
      completedAt: after.completedAt,
      isDone: after.isDone,
      statusName: after.statusName,
      statusKey: after.statusKey,
      progressPercentage:
        field === "statusId" ? 100 : before.progressPercentage,
    });
    expect(after.sortOrder).toBe(before.sortOrder);
    expect(await run.context.tasks.getById(run.owner, sibling.id)).toEqual(
      siblingBefore,
    );
    if (field === "statusId") expect(after.completedAt).not.toBeNull();
    expect(
      await run.planning.tickets.apply(planningIdentity, operation, parameters),
    ).toEqual(first);
    expect(run.publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "owner" }),
      after,
    );
    expect(run.listener).toHaveBeenCalledExactlyOnceWith({
      type: "ticket.updated",
      id: item.id,
    });
    expect(run.invalidate).toHaveBeenCalledOnce();
  },
);

it.each([
  ["ticket.setTitle", "expectedTitle", "title", "Original"],
  [
    "ticket.setDescription",
    "expectedDescription",
    "description",
    "Original body",
  ],
  ["ticket.setStatus", "expectedStatusId", "statusId", "status-backlog"],
] as const)(
  "rejects a stale %s and keeps an already applied value silent",
  async (operation, expectedKey, valueKey, original) => {
    const run = await setup();
    const item = await createTicket(run);
    const before = await run.context.tasks.getById(run.owner, item.id);
    run.publish.mockClear();
    run.listener.mockClear();
    const next = operation === "ticket.setStatus" ? "status-done" : "New";
    const input = {
      operationId: "stale",
      ticketId: item.id,
      [expectedKey]: "obsolete",
      [valueKey]: next,
    };
    await expect(
      run.planning.tickets.apply(planningIdentity, operation, input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await run.context.tasks.getById(run.owner, item.id)).toEqual(before);
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
    ).toEqual([[1]]);
    expect(
      await run.planning.tickets.apply(planningIdentity, operation, {
        ...input,
        operationId: "no-change",
        [valueKey]: original,
      }),
    ).toMatchObject({ result: { changed: false } });
    expect(run.publish).not.toHaveBeenCalled();
    expect(run.listener).not.toHaveBeenCalled();
  },
);

it("changes and removes parents by key and ID, detects obsolete parents and never publishes them to GitHub", async () => {
  const run = await setup();
  const epic = await createTicket(run, { operationId: "epic", type: "epic" });
  const second = await createTicket(run, {
    operationId: "second",
    type: "epic",
  });
  const task = await createTicket(run, {
    operationId: "task",
    parentId: epic.key,
  });
  run.publish.mockClear();
  const change = {
    operationId: "parent",
    ticketId: task.id,
    expectedParentId: epic.key.toLowerCase(),
    parentId: second.id,
  };
  expect(
    await run.planning.tickets.apply(
      planningIdentity,
      "ticket.setParent",
      change,
    ),
  ).toMatchObject({ result: { field: "parent", changed: true } });
  expect(
    await run.planning.tickets.apply(
      planningIdentity,
      "ticket.setParent",
      change,
    ),
  ).toMatchObject({ result: { changed: true } });
  await expect(
    run.planning.tickets.apply(planningIdentity, "ticket.setParent", {
      ...change,
      operationId: "stale",
      parentId: null,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await run.planning.tickets.apply(planningIdentity, "ticket.setParent", {
      ...change,
      operationId: "already-set",
    }),
  ).toMatchObject({ result: { changed: false } });
  expect(
    await run.planning.tickets.apply(planningIdentity, "ticket.setParent", {
      ...change,
      operationId: "detach",
      expectedParentId: second.id,
      parentId: null,
    }),
  ).toMatchObject({ result: { changed: true } });
  expect(
    await run.planning.tickets.apply(planningIdentity, "ticket.setParent", {
      ...change,
      operationId: "attach",
      expectedParentId: null,
      parentId: epic.key,
    }),
  ).toMatchObject({ result: { changed: true } });
  expect(run.publish).not.toHaveBeenCalled();
});

it("rejects unfit, foreign, hidden, self and archived parents without changing the ticket", async () => {
  const run = await setup();
  const task = await createTicket(run);
  const foreign = await createTicket(run, {
    operationId: "foreign",
    projectId: "p2",
    type: "epic",
  });
  const archived = await createTicket(run, {
    operationId: "archived",
    type: "epic",
  });
  await run.repository.archiveMany([archived.id]);
  const before = await run.context.tasks.getById(run.owner, task.id);
  for (const [parentId, userId, code] of [
    [task.id, "owner", "INVALID_REQUEST"],
    [foreign.id, "owner", "INVALID_REQUEST"],
    [foreign.id, "writer", "NOT_FOUND"],
    [archived.id, "owner", "INVALID_REQUEST"],
    ["missing", "owner", "NOT_FOUND"],
  ]) {
    await expect(
      run.planning.tickets.apply(
        { ...planningIdentity, userId },
        "ticket.setParent",
        {
          operationId: `parent-${parentId}-${userId}`,
          ticketId: task.id,
          expectedParentId: null,
          parentId,
        },
      ),
    ).rejects.toMatchObject({ code });
  }
  expect(await run.context.tasks.getById(run.owner, task.id)).toEqual(before);
});

it("checks current write access before replay and hides missing or inaccessible tickets", async () => {
  const run = await setup();
  const input = planningTicket({ operationId: "writer-create" });
  await run.planning.tickets.apply(
    { ...planningIdentity, userId: "writer" },
    "ticket.create",
    input,
  );
  await run.database.execute(
    "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
  );
  await expect(
    run.planning.tickets.apply(
      {
        ...planningIdentity,
        userId: "writer",
        isAdmin: true,
        permissions: ["write"],
      },
      "ticket.create",
      input,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const hidden = await createTicket(run, {
    operationId: "hidden",
    projectId: "p2",
  });
  for (const ticketId of [hidden.id, "missing"]) {
    await expect(
      run.planning.reads.readTicket(
        { ...planningIdentity, userId: "reader" },
        { ticketId },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
});

it("rolls back an object and operation key if storing the result fails, with no event or publication", async () => {
  const run = await setup();
  vi.spyOn(TaskRepository.prototype, "insertHistory").mockRejectedValueOnce(
    new Error("history unavailable"),
  );
  await expect(
    run.planning.tickets.apply(
      planningIdentity,
      "ticket.create",
      planningTicket(),
    ),
  ).rejects.toThrow("history unavailable");
  expect(await run.database.query("SELECT COUNT(*) FROM work_items;")).toEqual([
    [0],
  ]);
  expect(
    await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
  ).toEqual([[0]]);
  expect(run.publish).not.toHaveBeenCalled();
  expect(run.listener).not.toHaveBeenCalled();
});

it("recovers concurrent identical calls with one ticket and permits only one conflicting title change", async () => {
  const run = await setup();
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      run.planning.tickets.apply(
        planningIdentity,
        "ticket.create",
        planningTicket(),
      ),
    ),
  );
  for (const response of responses) expect(response).toEqual(responses[0]);
  expect(await run.database.query("SELECT key FROM work_items;")).toEqual([
    ["PAGE-1"],
  ]);
  expect(
    await run.database.query(
      "SELECT last_number FROM project_keys WHERE project_id = 'p1';",
    ),
  ).toEqual([[1]]);
  expect(run.listener).toHaveBeenCalledOnce();
  const changes = await Promise.allSettled(
    ["First", "Second"].map((title) =>
      run.planning.tickets.apply(planningIdentity, "ticket.setTitle", {
        operationId: title,
        ticketId: "PAGE-1",
        expectedTitle: "Original",
        title,
      }),
    ),
  );
  expect(changes.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  const rejection = changes.find(({ status }) => status === "rejected");
  expect(rejection).toMatchObject({
    status: "rejected",
    reason: { code: "CONFLICT" },
  });
  expect(
    await run.database.query("SELECT COUNT(*) FROM agent_operation_keys;"),
  ).toEqual([[2]]);
  expect(run.listener).toHaveBeenCalledTimes(2);
});

it("uses MCP policy for project lists, assignment filtering and account facts in role mode", async () => {
  const run = await setup();
  const context = createAgentTaskContext(run.database, run.owner);
  expect(
    (await context.projects.findAll(run.owner)).map(({ id }) => id).sort(),
  ).toEqual(["p1", "p2"]);
  expect(
    (await context.projects.authorizationFacts(run.owner)).account,
  ).toMatchObject({ isAdmin: true, mode: "admin" });
  expect(
    (await new AuthorizationRepository(run.database).snapshot()).accounts.find(
      ({ userId }) => userId === "owner",
    )?.mode,
  ).toBe("role");
  expect(await context.permissions.hasCapability(run.writer, "write")).toBe(
    true,
  );
  const candidates = new Map([
    ["p1", [run.owner, run.writer]],
    ["p2", [run.owner, run.writer]],
  ]);
  const filtered = await context.projects.filterAssignees(candidates);
  expect(
    filtered
      .get("p1")
      ?.map(({ id }) => id)
      .sort(),
  ).toEqual(["owner", "writer"]);
  expect(filtered.get("p2")).toEqual([]);
});
