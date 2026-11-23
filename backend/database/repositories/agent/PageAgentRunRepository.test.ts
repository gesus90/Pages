import { expect, it, vi } from "vitest";

import { PageAgentRunRepository } from "./PageAgentRunRepository";

import { Database } from "@/backend/database/Database";
import type { DatabaseValue } from "@/backend/database/Database";
import type { PageAgentRunRecord } from "@/definition/PageAgent";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Database;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const database = vi.mockObject(Database.prototype);
  const execute = vi.spyOn(database, "execute").mockResolvedValue();
  const query = vi.spyOn(database, "query").mockResolvedValue(rows);
  return { database, execute, query };
}

const RECORD: PageAgentRunRecord = {
  agentId: "a1",
  runId: "r1",
  planRunId: "p1",
  userId: "u1",
  startedAt: "2026-01-01T00:00:00Z",
  finishedAt: "2026-01-01T00:01:00Z",
  status: "succeeded",
  model: "m",
  reasoningEffort: null,
  input: "in",
  result: "out",
};

const RECORD_ROW: DatabaseValue[] = [
  "a1",
  "r1",
  "p1",
  "u1",
  "2026-01-01T00:00:00Z",
  "2026-01-01T00:01:00Z",
  "succeeded",
  "m",
  null,
  "in",
  "out",
];

it("pins the input of a step", async () => {
  const { database, execute } = databaseOf();
  await new PageAgentRunRepository(database).pinInput("p1", "s1", {
    prompt: "hi",
    startedAt: "t",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    plan_run_id: "p1",
    step_id: "s1",
    prompt: "hi",
    started_at: "t",
  });
});

it("finds a pinned input or null", async () => {
  const found = databaseOf([["hi", "t"]]);
  await expect(
    new PageAgentRunRepository(found.database).findInput("p1", "s1"),
  ).resolves.toEqual({ prompt: "hi", startedAt: "t" });
  await expect(
    new PageAgentRunRepository(databaseOf().database).findInput("p1", "s1"),
  ).resolves.toBeNull();
});

it("discards a pinned input", async () => {
  const { database, execute } = databaseOf();
  await new PageAgentRunRepository(database).discardInput("p1", "s1");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    plan_run_id: "p1",
    step_id: "s1",
  });
});

it("saves a record and returns the stored one", async () => {
  const { database, execute } = databaseOf([RECORD_ROW]);
  await expect(
    new PageAgentRunRepository(database).save(RECORD),
  ).resolves.toEqual(RECORD);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    agent_id: "a1",
    run_id: "r1",
    reasoning_effort: null,
    status: "succeeded",
  });
});

it("finds a record with a reasoning effort", async () => {
  const { database } = databaseOf([
    [...RECORD_ROW.slice(0, 8), "high", "in", "out"],
  ]);
  await expect(
    new PageAgentRunRepository(database).find("a1", "r1"),
  ).resolves.toMatchObject({ reasoningEffort: "high" });
});

it("returns null for a missing record and rejects get", async () => {
  const repository = new PageAgentRunRepository(databaseOf().database);
  await expect(repository.find("a1", "r1")).resolves.toBeNull();
  await expect(repository.get("a1", "r1")).rejects.toMatchObject({
    code: "plan_invalid",
  });
});

it("rejects a record with an unknown status", async () => {
  const { database } = databaseOf([
    [...RECORD_ROW.slice(0, 6), "bogus", ...RECORD_ROW.slice(7)],
  ]);
  await expect(
    new PageAgentRunRepository(database).find("a1", "r1"),
  ).rejects.toMatchObject({ code: "plan_invalid" });
});

it("lists record keys", async () => {
  const { database } = databaseOf([["a1", "r1"]]);
  await expect(new PageAgentRunRepository(database).keys()).resolves.toEqual([
    { agentId: "a1", runId: "r1" },
  ]);
});

it("marks a plan run as archived", async () => {
  const { database, execute } = databaseOf();
  await new PageAgentRunRepository(database).markArchived("p1");
  expect(execute.mock.calls[0]?.[1]).toEqual({ plan_run_id: "p1" });
});

it("resolves an inline snapshot text unchanged", async () => {
  const { database } = databaseOf();
  await expect(
    new PageAgentRunRepository(database).snapshotText("{}"),
  ).resolves.toBe("{}");
});

it("lists unarchived plan runs", async () => {
  const { database } = databaseOf([["p1", "{}", "[]"]]);
  await expect(
    new PageAgentRunRepository(database).unarchived(),
  ).resolves.toEqual([{ id: "p1", viewJson: "{}", snapshotJson: "[]" }]);
});
