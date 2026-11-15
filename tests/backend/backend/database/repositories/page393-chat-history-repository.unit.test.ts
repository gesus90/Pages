import { describe, expect, it, vi } from "vitest";

import { AgentChatHistoryRepository } from "@/backend/database/repositories/conversation/AgentChatHistoryRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";

type Row = DatabaseValue[];

interface Call {
  readonly sql: string;
  readonly parameters: SqlParameters | undefined;
}

/** A database that records every query and answers it with the prepared rows. */
function database(rows: Row[] = []): {
  readonly calls: Call[];
  readonly query: DatabaseTransaction["query"];
} {
  const calls: Call[] = [];
  return {
    calls,
    query: vi.fn<DatabaseTransaction["query"]>(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return rows;
    }),
  };
}

function row(overrides: Partial<Record<number, DatabaseValue>> = {}): Row {
  const values: DatabaseValue[] = [
    "conversation",
    "group",
    "group-team",
    "Pages-Team",
    "group-team",
    "group-1",
    41n,
    "Mei",
    "2026-10-20T09:00:00.000Z",
    "Ruhezeit bleibt bei 11 Stunden.",
  ];
  for (const [index, value] of Object.entries(overrides))
    values[Number(index)] = value ?? null;
  return values;
}

/** The SQL without line breaks and repeated spaces, to look for conditions. */
function flat(sql: string): string {
  return sql.replace(/\s+/gu, " ");
}

const FILTER = {
  words: [],
  chat: null,
  sender: null,
  since: null,
  before: null,
  limit: 30,
} as const;

describe("PAGE-393 AgentChatHistoryRepository visibility", () => {
  it("reads only chats the agent is a member of now, without deleted or dissolved ones", async () => {
    const db = database();
    await new AgentChatHistoryRepository(db).search("ed", null, FILTER);
    const sql = flat(db.calls[0]?.sql ?? "");
    // Direct chats only while the person keeps the agent in their list.
    expect(sql).toContain("agent_conversations.agent_id = $agent_id");
    expect(sql).toContain("agent_conversations.purpose = 'chat'");
    expect(sql).toContain(
      "chat_contacts.owner_id = agent_conversations.person_id AND chat_contacts.contact_id = agent_conversations.agent_id",
    );
    // Conversations only with the agent's current membership, not those of a deleted agent.
    expect(sql).toContain("FROM conversation_members AS membership");
    expect(sql).toContain("WHERE membership.user_id = $agent_id");
    expect(sql).toContain("conversations.deleted_agent_id IS NULL");
    // Deleted messages and dissolved groups have no rows: inner joins only find existing ones.
    expect(sql).toContain(
      "INNER JOIN conversations ON conversations.id = membership.conversation_id INNER JOIN conversation_messages ON conversation_messages.conversation_id = conversations.id",
    );
    expect(sql).toContain(
      "INNER JOIN chat_messages ON chat_messages.session_id = agent_conversations.chat_session_id",
    );
    // Hints of Pages are no messages.
    expect(sql).toContain("conversation_messages.notice IS NULL");
    expect(db.calls[0]?.parameters).toMatchObject({
      agent_id: "ed",
      limit: 30,
    });
  });

  it("shows a confidential chat only from inside itself", async () => {
    const db = database();
    const repository = new AgentChatHistoryRepository(db);
    await repository.search("ed", null, FILTER);
    await repository.search("ed", { kind: "direct", personId: "igor" }, FILTER);
    await repository.search(
      "ed",
      { kind: "conversation", conversationId: "group-team" },
      FILTER,
    );
    const sql = flat(db.calls[0]?.sql ?? "");
    expect(sql).toContain(
      "agent_conversations.is_confidential AS is_confidential",
    );
    expect(sql).toContain(
      "conversations.is_confidential OR ( conversations.kind = 'direct'",
    );
    expect(sql).toContain(
      "NOT is_confidential OR (chat_kind = $current_kind AND chat_id = $current_id) OR conversation_id = $current_conversation",
    );
    expect(db.calls.map((call) => call.parameters)).toEqual([
      expect.objectContaining({
        current_kind: "",
        current_id: "",
        current_conversation: "",
      }),
      expect.objectContaining({
        current_kind: "direct",
        current_id: "igor",
        current_conversation: "",
      }),
      expect.objectContaining({
        current_kind: "group",
        current_id: "group-team",
        current_conversation: "group-team",
      }),
    ]);
  });

  it("binds every word and filter as a parameter, the newest first", async () => {
    const db = database([
      row(),
      row({ 0: "direct", 1: "direct", 4: null, 6: 3 }),
    ]);
    const found = await new AgentChatHistoryRepository(db).search("ed", null, {
      words: ["ruhe%zeit", "elf_"],
      chat: "Team",
      sender: "Mei",
      since: "2026-10-01T00:00:00.000Z",
      before: "2026-11-01T00:00:00.000Z",
      limit: 9,
    });
    const call = db.calls[0];
    const sql = flat(call?.sql ?? "");
    expect(sql).toContain("lower(visible.text) LIKE $word_0 ESCAPE '\\'");
    expect(sql).toContain("lower(visible.text) LIKE $word_1 ESCAPE '\\'");
    expect(sql).toContain(
      "(lower(visible.chat_name) LIKE $chat ESCAPE '\\' OR visible.chat_id = $chat_exact)",
    );
    expect(sql).toContain(
      "lower(visible.sender_name) LIKE $sender ESCAPE '\\'",
    );
    expect(sql).toContain("visible.created_at >= $since");
    expect(sql).toContain("visible.created_at < $before");
    expect(sql).toContain(
      "ORDER BY visible.created_at DESC, visible.position DESC",
    );
    expect(call?.parameters).toMatchObject({
      word_0: "%ruhe\\%zeit%",
      word_1: "%elf\\_%",
      chat: "%team%",
      chat_exact: "Team",
      sender: "%mei%",
      since: "2026-10-01T00:00:00.000Z",
      before: "2026-11-01T00:00:00.000Z",
      limit: 9,
    });
    expect(found).toEqual([
      {
        source: "conversation",
        chatKind: "group",
        chatId: "group-team",
        chatName: "Pages-Team",
        conversationId: "group-team",
        messageId: "group-1",
        position: 41,
        senderName: "Mei",
        createdAt: "2026-10-20T09:00:00.000Z",
        text: "Ruhezeit bleibt bei 11 Stunden.",
      },
      expect.objectContaining({
        source: "direct",
        chatKind: "direct",
        conversationId: null,
        position: 3,
      }),
    ]);
  });
});

describe("PAGE-393 AgentChatHistoryRepository.around", () => {
  it("reads the visible message with its neighbours of the same chat", async () => {
    const db = database([
      row({ 5: "group-0", 6: 40n }),
      row(),
      row({ 5: "group-2", 6: 42n }),
    ]);
    const found = await new AgentChatHistoryRepository(db).around(
      "ed",
      { kind: "conversation", conversationId: "group-team" },
      { messageId: "group-1", before: 1, after: 1 },
    );
    const call = db.calls[0];
    const sql = flat(call?.sql ?? "");
    expect(sql).toContain("FROM visible WHERE message_id = $message_id");
    expect(sql).toContain(
      "WHERE visible.position < target.position ORDER BY visible.position DESC LIMIT $before",
    );
    expect(sql).toContain(
      "WHERE visible.position >= target.position ORDER BY visible.position LIMIT $after_and_hit",
    );
    expect(call?.parameters).toMatchObject({
      agent_id: "ed",
      message_id: "group-1",
      before: 1,
      after_and_hit: 2,
      current_conversation: "group-team",
    });
    expect(found?.hit.messageId).toBe("group-1");
    expect(found?.messages.map((message) => message.messageId)).toEqual([
      "group-0",
      "group-1",
      "group-2",
    ]);
  });

  it("answers null when the message is not visible", async () => {
    const found = await new AgentChatHistoryRepository(database()).around(
      "ed",
      null,
      {
        messageId: "hidden",
        before: 5,
        after: 5,
      },
    );
    expect(found).toBeNull();
  });
});
