import { expect, it, vi, type Mock } from "vitest";

import {
  ConversationObserverRunRepository,
  observerFailure,
  type ConversationObserverOutcome,
  type ConversationObserverRun,
} from "./ConversationObserverRunRepository";

import type { Database } from "@/backend/database/Database";

type Rows = (string | number | bigint | null)[][];

function databaseOf(...results: Rows[]): {
  readonly database: Pick<Database, "execute" | "query">;
  readonly execute: Mock<Database["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>();
  for (const rows of results) query.mockResolvedValueOnce(rows);
  return { database: { execute, query }, execute, query };
}

const RUN: ConversationObserverRun = {
  id: "r1",
  conversationId: "c1",
  kind: "routing",
  trigger: "m1",
  personId: "u1",
  connectionId: null,
  model: "m",
  state: "succeeded",
  errorCode: null,
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
  startedAt: "s",
  endedAt: "e",
};

const FAILED: ConversationObserverOutcome = {
  kind: "summary",
  state: "failed",
  errorCode: null,
  endedAt: "t",
};

it("returns no failure for a succeeded call", () => {
  expect(observerFailure({ ...FAILED, state: "succeeded" })).toBeNull();
});

it("names a failure with its code or the fallback code", () => {
  expect(observerFailure(FAILED)).toEqual({
    kind: "summary",
    state: "failed",
    code: "observer_failed",
    at: "t",
  });
  expect(observerFailure({ ...FAILED, errorCode: "x" })?.code).toBe("x");
});

it("records a run with its columns", async () => {
  const { database, execute } = databaseOf();
  await new ConversationObserverRunRepository(database).record(RUN);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "r1",
    conversation_id: "c1",
    total_tokens: 3,
    ended_at: "e",
  });
});

it("reads the latest outcomes", async () => {
  const { database, query } = databaseOf([
    ["summary", "refused", "code", "t1"],
    ["routing", "succeeded", null, "t2"],
  ]);
  await expect(
    new ConversationObserverRunRepository(database).latest("c1", 2),
  ).resolves.toEqual([
    { kind: "summary", state: "refused", errorCode: "code", endedAt: "t1" },
    { kind: "routing", state: "succeeded", errorCode: null, endedAt: "t2" },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({ conversation_id: "c1", limit: 2 });
});

it("rejects an unknown kind and an unknown state", async () => {
  const kind = databaseOf([["other", "failed", null, "t"]]);
  await expect(
    new ConversationObserverRunRepository(kind.database).latest("c", 1),
  ).rejects.toThrow("Invalid observer run kind");
  const state = databaseOf([["routing", "other", null, "t"]]);
  await expect(
    new ConversationObserverRunRepository(state.database).latest("c", 1),
  ).rejects.toThrow("Invalid observer run state");
});

it("summarizes the health with counts and the newest failure", async () => {
  const { database } = databaseOf(
    [
      ["succeeded", 5n, "ok"],
      ["failed", 2, "bad"],
      ["refused", 1, null],
    ],
    [["routing", "failed", "boom", "t"]],
  );
  await expect(
    new ConversationObserverRunRepository(database).health("since"),
  ).resolves.toEqual({
    since: "since",
    succeeded: 5,
    failed: 2,
    refused: 1,
    lastSuccessAt: "ok",
    lastFailure: { kind: "routing", state: "failed", code: "boom", at: "t" },
  });
});

it("reports an empty health without success or failure", async () => {
  const { database } = databaseOf([], []);
  await expect(
    new ConversationObserverRunRepository(database).health("s"),
  ).resolves.toEqual({
    since: "s",
    succeeded: 0,
    failed: 0,
    refused: 0,
    lastSuccessAt: null,
    lastFailure: null,
  });
});
