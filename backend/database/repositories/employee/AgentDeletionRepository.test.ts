import { expect, it, vi } from "vitest";

import { AgentDeletionRepository } from "./AgentDeletionRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentDeletionCounts } from "@/definition/AgentDeletion";

type Rows = (readonly (readonly DatabaseValue[])[])[];

function doubleOf(queue: Rows): {
  repository: AgentDeletionRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => queue.shift() ?? []);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentDeletionRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

const COUNT_ROW: readonly DatabaseValue[] = [
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9n,
  10,
  11,
  12,
  13,
];

const COUNTS: AgentDeletionCounts = {
  directChats: 1,
  sessions: 2,
  memoryEntries: 3,
  ownedPlans: 4,
  runs: 5,
  files: 6,
  credentials: 7,
  groupMemberships: 8,
  assignedTickets: 9,
};

it("reads the inventory with blockers and a fingerprint", async () => {
  const { repository } = doubleOf([
    [COUNT_ROW],
    [["p 1", "Plan"]],
    [["r1", "p 1", "running"]],
    [["hash"]],
  ]);

  const inventory = await repository.inventory("a1");

  expect(inventory.deletes).toEqual(COUNTS);
  expect(inventory.keeps).toEqual({
    groupChatMessages: 10,
    ticketChanges: 11,
    wikiChanges: 12,
    commits: 0,
  });
  expect(inventory.ownedPlans).toEqual([{ id: "p 1", name: "Plan" }]);
  expect(inventory.blockers).toEqual([
    {
      code: "active_runs",
      detail: "r1 (running)",
      link: "/agents/plans?planId=p%201",
    },
  ]);
  expect(JSON.parse(inventory.fingerprint)).toMatchObject({
    inventory: "hash",
    revision: 13,
  });
});

it("reads an empty fingerprint when the hash row is missing", async () => {
  const { repository } = doubleOf([[COUNT_ROW], [], [], []]);

  const inventory = await repository.inventory("a1");

  expect(JSON.parse(inventory.fingerprint)).toMatchObject({ inventory: "" });
});

it("rejects a missing inventory row", async () => {
  const { repository } = doubleOf([[], [], [], []]);

  await expect(repository.inventory("a1")).rejects.toThrow(
    "Agent inventory is missing.",
  );
});

it("rejects an inventory without a revision", async () => {
  const { repository } = doubleOf([
    [[...COUNT_ROW.slice(0, 12), null]],
    [],
    [],
    [],
  ]);

  await expect(repository.inventory("a1")).rejects.toThrow(
    "Agent inventory is missing.",
  );
});

it("saves a preview", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.savePreview({
    id: "pv",
    agentId: "a1",
    actorId: "u1",
    fingerprint: "f",
    expiresAt: "t",
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "pv",
    agent_id: "a1",
    actor_id: "u1",
    fingerprint: "f",
    expires_at: "t",
  });
});

it("finds a preview or null", async () => {
  const found = doubleOf([[["a1", "u1", "f", "t"]]]);
  const missing = doubleOf([[]]);

  expect(await found.repository.findPreview("pv")).toEqual({
    agentId: "a1",
    actorId: "u1",
    fingerprint: "f",
    expiresAt: "t",
  });
  expect(await missing.repository.findPreview("pv")).toBeNull();
});

it("finds an operation, null, or rejects an invalid action", async () => {
  const found = doubleOf([[["restore", "a1", "u1", "{}"]]]);
  const missing = doubleOf([[]]);
  const invalid = doubleOf([[["purge", "a1", "u1", "{}"]]]);

  expect(await found.repository.findOperation("o1")).toEqual({
    action: "restore",
    agentId: "a1",
    actorId: "u1",
    result: "{}",
  });
  expect(await missing.repository.findOperation("o1")).toBeNull();
  await expect(invalid.repository.findOperation("o1")).rejects.toThrow(
    "Invalid deletion operation.",
  );
});

it("accepts a delete operation", async () => {
  const { repository } = doubleOf([[["delete", "a1", "u1", "{}"]]]);

  expect((await repository.findOperation("o1"))?.action).toBe("delete");
});

it("saves an operation with a serialized result", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.saveOperation({
    id: "o1",
    action: "delete",
    agentId: "a1",
    actorId: "u1",
    result: { ok: true },
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "o1",
    action: "delete",
    agent_id: "a1",
    actor_id: "u1",
    result: '{"ok":true}',
  });
});

it("soft-deletes the agent and revokes credentials", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.delete({
    agentId: "a1",
    actorId: "u1",
    displayName: "Agent",
    deletedAt: "2026-01-01T00:00:00.000Z",
    restorableUntil: "2026-02-01T00:00:00.000Z",
    counts: COUNTS,
    eventId: "e1",
  });

  const parameters = execute.mock.calls.map((call) => call[1]);
  expect(parameters).toHaveLength(10);
  expect(parameters[0]).toMatchObject({
    agent_id: "a1",
    counts: JSON.stringify(COUNTS),
  });
  expect(parameters[2]).toEqual({
    agent_id: "a1",
    revoked_at: Date.parse("2026-01-01T00:00:00.000Z"),
  });
  expect(parameters[8]).toMatchObject({ event_id: "e1" });
  expect(parameters[9]).toEqual({ agent_id: "a1" });
});

it("finds an unpurged deletion or null", async () => {
  const found = doubleOf([[["a1", "Agent", "d", "r"]]]);
  const missing = doubleOf([[]]);

  expect(await found.repository.findDeletion("a1")).toEqual({
    agentId: "a1",
    displayName: "Agent",
    deletedAt: "d",
    restorableUntil: "r",
  });
  expect(await missing.repository.findDeletion("a1")).toBeNull();
});

it("restores the agent and removes the deletion record", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.restore("a1", "u1", "t", "e1");

  const parameters = execute.mock.calls.map((call) => call[1]);
  expect(parameters).toHaveLength(9);
  expect(parameters[0]).toEqual({ agent_id: "a1", restored_at: "t" });
  expect(parameters[7]).toEqual({
    agent_id: "a1",
    actor_id: "u1",
    restored_at: "t",
    event_id: "e1",
  });
});

it("lists deleted agents with a next cursor", async () => {
  const { repository, query } = doubleOf([
    [
      ["a1", "One", "d1", "u1", "Admin", "r1"],
      ["a2", "Two", "d2", "u1", "Admin", "r2"],
    ],
  ]);

  const page = await repository.listDeleted(null, 1, "now");

  expect(page).toEqual({
    agents: [
      {
        agentId: "a1",
        displayName: "One",
        deletedAt: "d1",
        deletedBy: { id: "u1", displayName: "Admin" },
        restorableUntil: "r1",
      },
    ],
    nextCursor: "a1",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    cursor: null,
    limit: 2,
    now: "now",
  });
});

it("lists the last page without a cursor", async () => {
  const { repository } = doubleOf([[["a1", "One", "d1", "u1", "Admin", "r1"]]]);

  expect((await repository.listDeleted("a0", 5, "now")).nextCursor).toBeNull();
});

it("returns no cursor when the limit leaves no agent", async () => {
  const { repository } = doubleOf([[["a1", "One", "d1", "u1", "Admin", "r1"]]]);

  const page = await repository.listDeleted(null, 0, "now");

  expect(page).toEqual({ agents: [], nextCursor: null });
});
