import { expect, it, vi } from "vitest";

import { ChatContextRepository } from "@/backend/database/repositories/chat/ChatContextRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";

function queryFixture(rows: DatabaseValue[][]): {
  readonly query: ReturnType<
    typeof vi.fn<
      (
        statement: string,
        parameters?: SqlParameters,
      ) => Promise<DatabaseValue[][]>
    >
  >;
} {
  return {
    query: vi
      .fn<
        (
          statement: string,
          parameters?: SqlParameters,
        ) => Promise<DatabaseValue[][]>
      >()
      .mockResolvedValue(rows),
  };
}

it("reads summaries only for their owner and distinguishes absent sessions", async () => {
  const boundary = queryFixture([["Summary", "message-5", 2]]);
  const repository = new ChatContextRepository(boundary);
  expect(await repository.read("owner", "session")).toEqual({
    summary: "Summary",
    throughId: "message-5",
    revision: 2,
  });
  const [statement, parameters] = boundary.query.mock.calls[0];
  expect(statement).toContain("AND user_id = $user_id");
  expect(parameters).toEqual({ user_id: "owner", session_id: "session" });
  boundary.query.mockResolvedValueOnce([]);
  expect(await repository.read("foreign", "session")).toBeNull();
});

it("guards summary replacement by owner, context revision and latest message and never writes messages", async () => {
  const boundary = queryFixture([["session"]]);
  const repository = new ChatContextRepository(boundary);
  const replacement = {
    summary: "New summary",
    throughId: "message-5",
    expectedRevision: 2,
    latestId: "message-9",
  };
  expect(await repository.save("owner", "session", replacement)).toBe(true);
  const [statement, parameters] = boundary.query.mock.calls[0];
  expect(statement).toContain("AND user_id = $user_id");
  expect(statement).toContain("AND context_revision = $expected_revision");
  expect(statement).toContain("AND $latest_id = (");
  expect(statement).toContain("ORDER BY position DESC");
  expect(statement).not.toMatch(/(?:DELETE FROM|UPDATE) chat_messages/u);
  expect(parameters).toEqual({
    user_id: "owner",
    session_id: "session",
    summary: "New summary",
    through_id: "message-5",
    expected_revision: 2,
    latest_id: "message-9",
  });
  boundary.query.mockResolvedValueOnce([]);
  expect(await repository.save("owner", "session", replacement)).toBe(false);
});

it("lists all own sessions without the optional limit and rejects a foreign deletion before touching any child records", async () => {
  const boundary = queryFixture([]);
  const execute = vi.fn(async () => undefined);
  const transaction = async <Result>(
    work: (connection: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work({ ...boundary, execute });
  const repository = new ChatSessionRepository({
    ...boundary,
    execute,
    transaction,
  });
  expect(await repository.list("owner")).toEqual([]);
  expect(boundary.query.mock.calls[0][0]).not.toContain("LIMIT $limit");
  expect(boundary.query.mock.calls[0][1]).toEqual({ user_id: "owner" });
  expect(await repository.remove("foreign", "session")).toBeNull();
  expect(execute).not.toHaveBeenCalled();
  expect(boundary.query.mock.calls.at(-1)).toEqual([
    expect.stringContaining("id = $id AND user_id = $user_id"),
    { id: "session", user_id: "foreign" },
  ]);
});

it("stores a client message ID with its message and refuses a second message with it", async () => {
  const boundary = queryFixture([["session"]]);
  const execute = vi.fn(async () => undefined);
  const repository = new ChatSessionRepository({
    ...boundary,
    execute,
    transaction: async (work) => work({ ...boundary, execute }),
  });
  boundary.query
    .mockResolvedValueOnce([["session"]])
    .mockResolvedValueOnce([["message-1", "user", "Hallo", "today"]]);
  expect(
    await repository.append("owner", "session", {
      role: "user",
      content: "Hallo",
      clientMessageId: "browser-1",
    }),
  ).toEqual({
    id: "message-1",
    role: "user",
    content: "Hallo",
    createdAt: "today",
  });
  const [statement, parameters] = boundary.query.mock.calls[1];
  expect(statement).toContain("ON CONFLICT DO NOTHING");
  expect(parameters).toMatchObject({ client_message_id: "browser-1" });

  boundary.query.mockResolvedValueOnce([["session"]]).mockResolvedValueOnce([]);
  await expect(
    repository.append("owner", "session", {
      role: "user",
      content: "Hallo",
      clientMessageId: "browser-1",
    }),
  ).rejects.toMatchObject({ code: "messageAlreadySent" });

  boundary.query.mockResolvedValueOnce([
    ["message-1", "user", "Hallo", "today"],
  ]);
  expect((await repository.findByClientId("session", "browser-1"))?.id).toBe(
    "message-1",
  );
  expect(boundary.query.mock.calls.at(-1)?.[1]).toEqual({
    session_id: "session",
    client_message_id: "browser-1",
  });
});
