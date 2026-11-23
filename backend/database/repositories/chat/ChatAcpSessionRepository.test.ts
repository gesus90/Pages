import { expect, it, vi, type Mock } from "vitest";

import {
  ChatAcpSessionRepository,
  type ChatAcpSession,
} from "./ChatAcpSessionRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Pick<Database, "query" | "execute">;
  readonly execute: Mock<Database["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

const SESSION: ChatAcpSession = {
  chatSessionId: "s1",
  userId: "u1",
  connectionId: "c1",
  model: "m",
  reasoningEffort: null,
  profile: "p",
  acpSessionId: "a1",
  throughMessageId: "t1",
};

it("finds the agent session of an own conversation", async () => {
  const { database, query } = databaseOf([
    ["s1", "u1", "c1", "m", "high", "p", "a1", null],
  ]);
  await expect(
    new ChatAcpSessionRepository(database).find("u1", "s1"),
  ).resolves.toEqual({
    ...SESSION,
    reasoningEffort: "high",
    throughMessageId: null,
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    chat_session_id: "s1",
    user_id: "u1",
  });
});

it("returns null without a stored agent session", async () => {
  const { database } = databaseOf();
  await expect(
    new ChatAcpSessionRepository(database).find("u1", "s1"),
  ).resolves.toBeNull();
});

it("saves the agent session", async () => {
  const { database, execute } = databaseOf();
  await new ChatAcpSessionRepository(database).save(SESSION);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    chat_session_id: "s1",
    user_id: "u1",
    connection_id: "c1",
    model: "m",
    reasoning_effort: null,
    profile: "p",
    acp_session_id: "a1",
    through_message_id: "t1",
  });
});

it("removes the agent session of an own conversation", async () => {
  const { database, execute } = databaseOf();
  await new ChatAcpSessionRepository(database).remove("u1", "s1");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    chat_session_id: "s1",
    user_id: "u1",
  });
});
