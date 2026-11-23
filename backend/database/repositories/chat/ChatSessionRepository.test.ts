import { expect, it, vi, type Mock } from "vitest";

import {
  ChatSessionRepository,
  type NewChatMessage,
} from "./ChatSessionRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

type QueryResult = DatabaseValue[][];

function databaseOf(...results: QueryResult[]): {
  readonly database: Pick<Database, "query" | "execute" | "transaction">;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => results.shift() ?? [],
  );
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const transaction = vi.fn(
    async (work: (inner: DatabaseTransaction) => Promise<unknown>) =>
      work({ query, execute }),
  );
  return {
    database: { query, execute, transaction } as unknown as Pick<
      Database,
      "query" | "execute" | "transaction"
    >,
    query,
    execute,
  };
}

const MESSAGE_ROW: DatabaseValue[] = [
  "m1",
  "user",
  "hello",
  "2026-01-01",
  1,
  null,
  null,
];

it("tells whether an ID is in use", async () => {
  const used = databaseOf([["s1"]]);
  await expect(
    new ChatSessionRepository(used.database).exists("s1"),
  ).resolves.toBe(true);
  const free = databaseOf([]);
  await expect(
    new ChatSessionRepository(free.database).exists("s1"),
  ).resolves.toBe(false);
});

it("creates an empty session", async () => {
  const { database, execute } = databaseOf();
  await new ChatSessionRepository(database).create("u1", "s1");
  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "s1", user_id: "u1" });
});

it("lists sessions with a normalized preview, optionally limited", async () => {
  const row = ["s1", "c", "l", "a \n  b "];
  const all = databaseOf([row, ["s2", "c", "l", null]]);
  await expect(
    new ChatSessionRepository(all.database).list("u1"),
  ).resolves.toEqual([
    { id: "s1", createdAt: "c", lastMessageAt: "l", preview: "a b" },
    { id: "s2", createdAt: "c", lastMessageAt: "l", preview: "" },
  ]);
  expect(all.query.mock.calls[0]?.[1]).toEqual({ user_id: "u1" });
  const limited = databaseOf([row]);
  await new ChatSessionRepository(limited.database).list("u1", 5);
  expect(limited.query.mock.calls[0]?.[1]).toEqual({ user_id: "u1", limit: 5 });
});

it("finds an own session or returns null", async () => {
  const found = databaseOf([["s1", "c", "l", "p"]]);
  await expect(
    new ChatSessionRepository(found.database).find("u1", "s1"),
  ).resolves.toMatchObject({ id: "s1" });
  const missing = databaseOf([]);
  await expect(
    new ChatSessionRepository(missing.database).find("u1", "s1"),
  ).resolves.toBeNull();
});

it("reads messages with the stopped flag, preview origin and answer", async () => {
  const answer = { answerId: "a", durationMs: 1, tools: [] };
  const { database } = databaseOf([
    MESSAGE_ROW,
    ["m2", "assistant", "hi", "t", 0, "preview-1", JSON.stringify(answer)],
    ["m3", "assistant", "yo", "t", null, "other", null],
  ]);
  await expect(
    new ChatSessionRepository(database).messages("s1"),
  ).resolves.toEqual([
    {
      id: "m1",
      role: "user",
      content: "hello",
      createdAt: "2026-01-01",
      isStopped: true,
    },
    {
      id: "m2",
      role: "assistant",
      content: "hi",
      createdAt: "t",
      isFromPreview: true,
      agentAnswer: answer,
    },
    { id: "m3", role: "assistant", content: "yo", createdAt: "t" },
  ]);
});

it("rejects an unsupported role", async () => {
  const { database } = databaseOf([
    ["m1", "system", "x", "t", null, null, null],
  ]);
  await expect(
    new ChatSessionRepository(database).messages("s1"),
  ).rejects.toThrow('unsupported chat role "system"');
});

it("returns the newest messages in display order", async () => {
  const { database, query } = databaseOf([
    ["m2", "user", "b", "t", null, null, null],
    ["m1", "user", "a", "t", null, null, null],
  ]);
  const messages = await new ChatSessionRepository(database).newestMessages(
    "s1",
    2,
  );
  expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
  expect(query.mock.calls[0]?.[1]).toEqual({ session_id: "s1", limit: 2 });
});

it("finds a message by ID or client ID, or returns null", async () => {
  const found = databaseOf([MESSAGE_ROW], [MESSAGE_ROW]);
  const repository = new ChatSessionRepository(found.database);
  await expect(repository.findMessage("s1", "m1")).resolves.toMatchObject({
    id: "m1",
  });
  await expect(repository.findByClientId("s1", "c1")).resolves.toMatchObject({
    id: "m1",
  });
  const missing = databaseOf([], []);
  const empty = new ChatSessionRepository(missing.database);
  await expect(empty.findMessage("s1", "m1")).resolves.toBeNull();
  await expect(empty.findByClientId("s1", "c1")).resolves.toBeNull();
});

it("appends a message with client ID, stopped flag and answer", async () => {
  const answer = { answerId: "a", durationMs: 1, tools: [] };
  const { database, query } = databaseOf([["s1"]], [], [MESSAGE_ROW]);
  await expect(
    new ChatSessionRepository(database).append("u1", "s1", {
      role: "user",
      content: "hello",
      isStopped: true,
      clientMessageId: "c1",
      agentAnswer: answer,
    }),
  ).resolves.toMatchObject({ id: "m1" });
  expect(query.mock.calls[2]?.[1]).toMatchObject({
    client_message_id: "c1",
    is_stopped: true,
    agent_answer: JSON.stringify(answer),
  });
});

it("appends a message without optional fields", async () => {
  const { database, query } = databaseOf([["s1"]], [MESSAGE_ROW]);
  await new ChatSessionRepository(database).append("u1", "s1", {
    role: "assistant",
    content: "x",
  } as unknown as NewChatMessage);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[1]?.[1]).toMatchObject({
    client_message_id: null,
    is_stopped: null,
    agent_answer: null,
  });
});

it("refuses to append to a missing session", async () => {
  const { database } = databaseOf([]);
  await expect(
    new ChatSessionRepository(database).append("u1", "s1", {
      role: "user",
      content: "x",
      isStopped: false,
    }),
  ).rejects.toMatchObject({ code: "sessionMissing" });
});

it("refuses a client message ID that was already sent", async () => {
  const { database } = databaseOf([["s1"]], [["m1"]]);
  await expect(
    new ChatSessionRepository(database).append("u1", "s1", {
      role: "user",
      content: "x",
      isStopped: false,
      clientMessageId: "c1",
    }),
  ).rejects.toMatchObject({ code: "messageAlreadySent" });
});

it("replaces the content of an assistant answer", async () => {
  const done = databaseOf([["m1"]]);
  await expect(
    new ChatSessionRepository(done.database).replaceAnswerContent(
      "s1",
      "m1",
      "x",
    ),
  ).resolves.toBe(true);
  const none = databaseOf([]);
  await expect(
    new ChatSessionRepository(none.database).replaceAnswerContent(
      "s1",
      "m1",
      "x",
    ),
  ).resolves.toBe(false);
});

it("returns null when removing a foreign session", async () => {
  const { database, execute } = databaseOf([]);
  await expect(
    new ChatSessionRepository(database).remove("u1", "s1"),
  ).resolves.toBeNull();
  expect(execute).not.toHaveBeenCalled();
});

it("removes a session and returns its files in creation order", async () => {
  const { database, execute } = databaseOf(
    [["s1"]],
    [
      ["b.bin", 2],
      ["a.bin", 1],
    ],
  );
  await expect(
    new ChatSessionRepository(database).remove("u1", "s1"),
  ).resolves.toEqual(["a.bin", "b.bin"]);
  const statements = execute.mock.calls.map((call) => call[0]);
  expect(statements).toHaveLength(8);
  expect(statements.some((sql) => sql.includes("chat_selections"))).toBe(true);
});
