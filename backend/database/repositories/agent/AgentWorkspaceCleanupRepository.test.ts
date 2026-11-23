import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";

import { AgentWorkspaceCleanupRepository } from "./AgentWorkspaceCleanupRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Pick<Database, "query" | "execute">;
  readonly execute: Mock<Database["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

const NOW = Date.parse("2026-01-02T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const ENTRY: AgentWorkspaceCleanup = {
  workspaceId: "w1",
  workspaceName: "W",
  runId: "r1",
  ownerId: "u1",
  blocker: "busy",
  updatedAt: "2026-01-02T00:00:00Z",
  state: "pending",
  attempts: 0,
  nextAttemptAt: 0,
  retryStartedAt: "2026-01-02T00:00:00Z",
  eventRevision: 3,
  stopRevision: 2,
};

const ROW: DatabaseValue[] = [
  "w1",
  "W",
  "r1",
  "u1",
  "busy",
  "2026-01-02T00:00:00Z",
  "needs_decision",
  2,
  5,
  "2026-01-01T00:00:00Z",
  3,
  2,
];

it("lists due pending obligations", async () => {
  const { database, query } = databaseOf([
    ROW,
    [...ROW.slice(0, 6), "x", ...ROW.slice(7)],
  ]);
  const entries = await new AgentWorkspaceCleanupRepository(database).pending();
  expect(entries.map((entry) => entry.state)).toEqual([
    "needs_decision",
    "pending",
  ]);
  expect(entries[0]).toMatchObject({
    workspaceId: "w1",
    attempts: 2,
    nextAttemptAt: 5,
    eventRevision: 3,
    stopRevision: 2,
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ now: NOW });
});

it("records progress with the event revision", async () => {
  const { database, execute } = databaseOf();
  const repository = new AgentWorkspaceCleanupRepository(database);
  await repository.record(ENTRY, "needs_decision", "late");
  await repository.record(
    { ...ENTRY, eventRevision: undefined },
    "pending",
    "b",
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    workspace_id: "w1",
    run_id: "r1",
    owner_id: "u1",
    state: "needs_decision",
    blocker: "late",
    revision: 3,
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ revision: 0 });
});

it("resets retry bookkeeping at startup", async () => {
  const { database, execute } = databaseOf();
  await new AgentWorkspaceCleanupRepository(database).resetAtStartup();
  expect(execute).toHaveBeenCalledTimes(1);
});

it("claims a stop only when a row was updated", async () => {
  const claimed = databaseOf([["r1"]]);
  await expect(
    new AgentWorkspaceCleanupRepository(claimed.database).claimStop(ENTRY),
  ).resolves.toBe(true);
  const missed = databaseOf();
  await expect(
    new AgentWorkspaceCleanupRepository(missed.database).claimStop({
      ...ENTRY,
      eventRevision: undefined,
    }),
  ).resolves.toBe(false);
  expect(missed.query.mock.calls[0]?.[1]).toMatchObject({ revision: 0 });
});

it("schedules the first retry shortly and stays pending", async () => {
  const { database, execute } = databaseOf();
  await new AgentWorkspaceCleanupRepository(database).failedAttempt(ENTRY, "b");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    attempts: 1,
    next: NOW + 2000,
    state: "pending",
    blocker: "b",
    revision: 3,
  });
});

it("caps the retry delay and escalates after eight attempts", async () => {
  const { database, execute } = databaseOf();
  await new AgentWorkspaceCleanupRepository(database).failedAttempt(
    { ...ENTRY, attempts: 7 },
    "b",
  );
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    attempts: 8,
    next: NOW + 900_000,
    state: "needs_decision",
  });
});

it("escalates an old obligation and reads a space-separated timestamp", async () => {
  const { database, execute } = databaseOf();
  await new AgentWorkspaceCleanupRepository(database).failedAttempt(
    {
      ...ENTRY,
      attempts: undefined,
      retryStartedAt: undefined,
      updatedAt: "2026-01-01 00:00:00",
      eventRevision: undefined,
    },
    "b",
  );
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    attempts: 1,
    state: "needs_decision",
    revision: 0,
  });
});

it("releases an obligation as completed by attestation", async () => {
  const { database, execute } = databaseOf();
  await new AgentWorkspaceCleanupRepository(database).decide(ENTRY, "release");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    state: "completed",
    blocker: "manual_release_host_reboot_verified",
  });
});

it("retries an obligation explicitly", async () => {
  const { database, execute } = databaseOf();
  await new AgentWorkspaceCleanupRepository(database).decide(ENTRY, "retry");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    workspace_id: "w1",
    run_id: "r1",
    owner_id: "u1",
  });
});

it("lists the obligations of a plan", async () => {
  const { database, query } = databaseOf([ROW]);
  await expect(
    new AgentWorkspaceCleanupRepository(database).forPlan("u1", "p1"),
  ).resolves.toHaveLength(1);
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1", plan_id: "p1" });
});

it("falls back to the longest delay for an invalid attempt count", async () => {
  const { database, execute } = databaseOf();
  await new AgentWorkspaceCleanupRepository(database).failedAttempt(
    { ...ENTRY, attempts: -5 },
    "b",
  );
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ next: NOW + 900_000 });
});
