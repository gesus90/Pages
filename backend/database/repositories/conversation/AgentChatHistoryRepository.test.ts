import { expect, it, vi, type Mock } from "vitest";

import {
  AgentChatHistoryRepository,
  type HistoryFilter,
} from "./AgentChatHistoryRepository";

import type { DatabaseValue } from "@/backend/database/Database";

const FILTER: HistoryFilter = {
  words: [],
  chat: null,
  sender: null,
  since: null,
  before: null,
  limit: 10,
};

function rowOf(
  id: string,
  overrides: Partial<Record<number, DatabaseValue>> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "direct",
    "direct",
    "p1",
    "Chat mit P",
    null,
    id,
    BigInt(3),
    "Sender",
    "2030-01-01",
    "Hello",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value as DatabaseValue;
  return row;
}

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: AgentChatHistoryRepository;
  readonly query: Mock;
} {
  const query = vi.fn(async () => rows);
  return { repository: new AgentChatHistoryRepository({ query }), query };
}

function callOf(query: ReturnType<typeof vi.fn>): {
  readonly statement: string;
  readonly parameters: Record<string, unknown>;
} {
  const [statement, parameters] = query.mock.calls[0] as [
    string,
    Record<string, unknown>,
  ];
  return { statement, parameters };
}

it("searches without narrowing parts", async () => {
  const { repository, query } = repositoryOf([
    rowOf("m1"),
    rowOf("m2", {
      0: "conversation",
      1: "group",
      4: "c1",
      6: 2,
    }),
  ]);
  const messages = await repository.search("a", null, FILTER);
  expect(messages).toEqual([
    {
      source: "direct",
      chatKind: "direct",
      chatId: "p1",
      chatName: "Chat mit P",
      conversationId: null,
      messageId: "m1",
      position: 3,
      senderName: "Sender",
      createdAt: "2030-01-01",
      text: "Hello",
    },
    expect.objectContaining({
      source: "conversation",
      chatKind: "group",
      conversationId: "c1",
      position: 2,
    }),
  ]);
  const { statement, parameters } = callOf(query);
  expect(statement).not.toContain("WHERE visible.");
  expect(parameters).toEqual({
    agent_id: "a",
    current_kind: "",
    current_id: "",
    current_conversation: "",
    limit: 10,
  });
});

it("narrows a search by every part and escapes wildcards", async () => {
  const { repository, query } = repositoryOf();
  await repository.search(
    "a",
    { kind: "direct", personId: "p9" },
    {
      words: ["A_b", "50%", "x\\y"],
      chat: "Team",
      sender: "Ann",
      since: "s",
      before: "b",
      limit: 5,
    },
  );
  const { statement, parameters } = callOf(query);
  expect(statement).toContain("WHERE lower(visible.text)");
  expect(parameters).toMatchObject({
    current_kind: "direct",
    current_id: "p9",
    current_conversation: "",
    word_0: "%a\\_b%",
    word_1: "%50\\%%",
    word_2: "%x\\\\y%",
    chat: "%team%",
    chat_exact: "Team",
    sender: "%ann%",
    since: "s",
    before: "b",
    limit: 5,
  });
});

it("uses the conversation of a group job as the current chat", async () => {
  const { repository, query } = repositoryOf();
  await repository.search(
    "a",
    { kind: "conversation", conversationId: "c7" },
    FILTER,
  );
  expect(callOf(query).parameters).toMatchObject({
    current_kind: "group",
    current_id: "c7",
    current_conversation: "c7",
  });
});

it("returns the hit with its neighbours", async () => {
  const { repository, query } = repositoryOf([
    rowOf("m1", { 6: 1 }),
    rowOf("m2", { 6: 2 }),
  ]);
  const result = await repository.around("a", null, {
    messageId: "m2",
    before: 1,
    after: 4,
  });
  expect(result?.hit.messageId).toBe("m2");
  expect(result?.messages).toHaveLength(2);
  expect(callOf(query).parameters).toMatchObject({
    message_id: "m2",
    before: 1,
    after_and_hit: 5,
  });
});

it("returns null when the target message is not visible", async () => {
  const { repository } = repositoryOf([rowOf("other")]);
  await expect(
    repository.around("a", null, { messageId: "m2", before: 1, after: 1 }),
  ).resolves.toBeNull();
});
