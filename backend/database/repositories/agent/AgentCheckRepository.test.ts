import { expect, it, vi, type Mock } from "vitest";

import { AgentCheckRepository } from "./AgentCheckRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentCheckSummary } from "@/definition/AgentConnection";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

const CHECKED_AT = "2026-01-01T00:00:00.000Z";

const SUMMARY: AgentCheckSummary = {
  status: "failed",
  errorCode: "provider_bad_response",
  checkedAt: CHECKED_AT,
  durationMs: 12,
  detail: { modelCount: 3 },
};

it("finds a stored check and sanitizes its detail", async () => {
  const { database, query } = databaseOf([
    [
      "failed",
      "provider_bad_response",
      JSON.stringify({ modelCount: 3, secret: "x" }),
      12,
      CHECKED_AT,
    ],
  ]);
  await expect(
    new AgentCheckRepository(database).find("c1", "auth"),
  ).resolves.toEqual(SUMMARY);
  expect(query.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    kind: "auth",
  });
});

it("finds a passed check without an error code", async () => {
  const { database } = databaseOf([
    ["passed", null, JSON.stringify([]), 5, CHECKED_AT],
  ]);
  await expect(
    new AgentCheckRepository(database).find("c1", "model"),
  ).resolves.toEqual({
    status: "passed",
    errorCode: null,
    detail: {},
    durationMs: 5,
    checkedAt: CHECKED_AT,
  });
});

it("returns null without a stored check", async () => {
  const { database } = databaseOf();
  await expect(
    new AgentCheckRepository(database).find("c1", "auth"),
  ).resolves.toBeNull();
});

it("rejects a stored check with an unknown status", async () => {
  const { database } = databaseOf([["weird", null, "{}", 1, CHECKED_AT]]);
  await expect(
    new AgentCheckRepository(database).find("c1", "auth"),
  ).rejects.toMatchObject({ code: "provider_bad_response" });
});

it("rejects a stored check with an unknown error code", async () => {
  const { database } = databaseOf([["failed", "nope", "{}", 1, CHECKED_AT]]);
  await expect(
    new AgentCheckRepository(database).find("c1", "auth"),
  ).rejects.toMatchObject({ code: "provider_bad_response" });
});

it("saves a check with sanitized detail and attribution", async () => {
  const { database, execute } = databaseOf();
  await new AgentCheckRepository(database).save(
    "c1",
    "auth",
    { ...SUMMARY, detail: { modelCount: 3, ...{ extra: "x" } } },
    "u1",
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    kind: "auth",
    status: "failed",
    error_code: "provider_bad_response",
    detail_json: JSON.stringify({ modelCount: 3 }),
    duration_ms: 12,
    checked_by: "u1",
    checked_at: CHECKED_AT,
  });
});

it("clears both check kinds of a connection", async () => {
  const { database, execute } = databaseOf();
  await new AgentCheckRepository(database).clear("c1");
  expect(execute.mock.calls[0]?.[1]).toEqual({ connection_id: "c1" });
});

it("clears only the model check of a connection", async () => {
  const { database, execute } = databaseOf();
  await new AgentCheckRepository(database).clearModel("c1");
  expect(execute.mock.calls[0]?.[0]).toContain("kind = 'model'");
  expect(execute.mock.calls[0]?.[1]).toEqual({ connection_id: "c1" });
});
