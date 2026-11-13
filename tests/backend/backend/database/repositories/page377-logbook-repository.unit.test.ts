import { expect, it, vi } from "vitest";

import { AgentLogbookRepository } from "@/backend/database/repositories/employee/AgentLogbookRepository";
import { AgentLogbookSessionRepository } from "@/backend/database/repositories/employee/AgentLogbookSessionRepository";
import { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { Mock } from "vitest";

type Row = DatabaseValue[];
type QueryFunction = DatabaseTransaction["query"];
type ExecuteFunction = DatabaseTransaction["execute"];

interface Call {
  readonly sql: string;
  readonly parameters: SqlParameters | undefined;
}

/** A database that records every statement and answers each query with the next prepared rows. */
function database(...answers: Row[][]): {
  readonly calls: Call[];
  readonly query: Mock<QueryFunction>;
  readonly execute: Mock<ExecuteFunction>;
} {
  const calls: Call[] = [];
  const queue = [...answers];
  const query = vi.fn<QueryFunction>(async (sql, parameters) => {
    calls.push({ sql, parameters });
    return queue.shift() ?? [];
  });
  const execute = vi.fn<ExecuteFunction>(async (sql, parameters) => {
    calls.push({ sql, parameters });
  });
  return { calls, query, execute };
}

function entryRow(overrides: Record<number, DatabaseValue> = {}): Row {
  const row: DatabaseValue[] = [
    "entry-1",
    7,
    "ed",
    "decision",
    "PAGE-370 übernimmt Ed bis Freitag.",
    "PAGE-370",
    "group",
    "group-team",
    "Pages-Team",
    '["Igor","Mei"]',
    "background",
    "2026-11-13T17:05:00.000Z",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

it("reads an entry with its source, people and origin", async () => {
  const db = database([
    entryRow(),
    entryRow({ 3: "unbekannt", 6: "direct", 10: "agent" }),
  ]);
  const entries = await new AgentLogbookRepository(db).find("ed", {
    words: [],
    chat: null,
    limit: 200,
  });
  expect(entries[0]).toEqual({
    id: "entry-1",
    sequence: 7,
    agentId: "ed",
    kind: "decision",
    text: "PAGE-370 übernimmt Ed bis Freitag.",
    topic: "PAGE-370",
    source: { kind: "group", id: "group-team", name: "Pages-Team" },
    participants: ["Igor", "Mei"],
    origin: "background",
    createdAt: "2026-11-13T17:05:00.000Z",
  });
  // A kind the code does not know reads as a note.
  expect(entries[1]).toMatchObject({
    kind: "note",
    source: { kind: "direct" },
    origin: "agent",
  });
});

it("leaves the entries of confidential chats out of every read, whenever the chat was marked", async () => {
  const db = database([], [], []);
  const repository = new AgentLogbookRepository(db);
  await repository.find("ed", { words: ["Freitag"], chat: null, limit: 20 });
  await repository.newSince("ed", 3, { kind: "group", id: "g" }, 3);
  const [find, news] = db.calls;
  for (const call of [find, news]) {
    // A direct chat is confidential by the mark of its session, a group by its conversation's.
    expect(call?.sql).toContain("agent_conversations.is_confidential");
    expect(call?.sql).toContain("conversations.is_confidential");
    expect(call?.sql).toContain("NOT (");
  }
  expect(find?.sql).toContain("ORDER BY agent_logbook_entries.sequence DESC");
  expect(find?.sql).toContain("LIMIT $limit");
});

it("looks every word up in the text, topic, chat name and people, taking % and _ literally", async () => {
  const db = database([]);
  await new AgentLogbookRepository(db).find("ed", {
    words: ["100%", "a_b"],
    chat: "Pages",
    limit: 10,
  });
  const [call] = db.calls;
  expect(call?.parameters).toEqual({
    agent_id: "ed",
    limit: 10,
    word_0: "%100\\%%",
    word_1: "%a\\_b%",
    chat: "%pages%",
  });
  expect(call?.sql).toContain("LIKE $word_0 ESCAPE");
  expect(call?.sql).toContain("LIKE $word_1 ESCAPE");
  expect(call?.sql).toContain("LIKE $chat ESCAPE");
  // The text, topic, chat and people are what a word has to hit.
  for (const column of ["text", "topic", "source_name", "participants"])
    expect(call?.sql).toContain(`agent_logbook_entries.${column}`);
});

it("takes at most six words into one search", async () => {
  const db = database([]);
  await new AgentLogbookRepository(db).find("ed", {
    words: ["a", "b", "c", "d", "e", "f", "g", "h"],
    chat: null,
    limit: 10,
  });
  const parameters = Object.keys(db.calls[0]?.parameters ?? {}).filter((key) =>
    key.startsWith("word_"),
  );
  expect(parameters).toHaveLength(6);
});

it("drops the oldest entries beyond the limit and keeps the newest ones, of that agent only", async () => {
  const db = database([["a"], ["b"]]);
  const dropped = await new AgentLogbookRepository(db).trimToLimit("ed", 200);
  expect(dropped).toBe(2);
  const [call] = db.calls;
  expect(call?.parameters).toEqual({ agent_id: "ed", limit: 200 });
  // Everything at or below the limit-th newest entry goes, nothing of another agent.
  expect(call?.sql).toContain("DELETE FROM agent_logbook_entries");
  expect(call?.sql).toContain("WHERE agent_id = $agent_id");
  expect(call?.sql).toContain("ORDER BY sequence DESC");
  expect(call?.sql).toContain("OFFSET $limit");
});

it("counts the entries of other chats since a stand and leaves the own chat out", async () => {
  const db = database([
    [3, "Thema 5"],
    [3, "Thema 4"],
    [3, "Thema 3"],
  ]);
  const news = await new AgentLogbookRepository(db).newSince(
    "ed",
    2,
    { kind: "direct", id: "person-igor" },
    3,
  );
  expect(news).toEqual({ count: 3, topics: ["Thema 5", "Thema 4", "Thema 3"] });
  const [call] = db.calls;
  expect(call?.parameters).toEqual({
    agent_id: "ed",
    stand: 2,
    source_kind: "direct",
    source_id: "person-igor",
    topics: 3,
  });
  expect(call?.sql).toContain("sequence > $stand");
  expect(call?.sql).toContain(
    "agent_logbook_entries.source_kind = $source_kind",
  );
  expect(call?.sql).toContain("ORDER BY agent_logbook_entries.sequence DESC");
  expect(
    await new AgentLogbookRepository(database([])).newSince(
      "ed",
      2,
      { kind: "direct", id: "p" },
      3,
    ),
  ).toEqual({ count: 0, topics: [] });
});

it("removes only entries of the given agent by ID, and every entry of one chat when it becomes confidential", async () => {
  const db = database([["a"]]);
  const repository = new AgentLogbookRepository(db);
  expect(await repository.remove("ed", ["a", "b"])).toBe(1);
  expect(db.calls[0]?.parameters).toEqual({
    agent_id: "ed",
    id_0: "a",
    id_1: "b",
  });
  expect(db.calls[0]?.sql).toContain("WHERE agent_id = $agent_id");
  expect(await repository.remove("ed", [])).toBe(0);
  expect(db.calls).toHaveLength(1);

  await repository.removeChat({ kind: "group", id: "group-team" }, null);
  expect(db.calls[1]?.parameters).toEqual({
    source_kind: "group",
    source_id: "group-team",
    agent_id: null,
  });
  await repository.removeChat({ kind: "direct", id: "person-igor" }, "ed");
  expect(db.calls[2]?.parameters).toMatchObject({ agent_id: "ed" });
});

it("saves limit, quiet time and model of an agent without touching its revision", async () => {
  const db = database([["ed"]], []);
  const repository = new AgentLogbookRepository(db);
  expect(
    await repository.saveSettings("ed", {
      limit: 120,
      quietMinutes: 5,
      model: { connectionId: "c", model: "m" },
    }),
  ).toBe(true);
  expect(db.calls[0]?.parameters).toEqual({
    agent_id: "ed",
    limit: 120,
    quiet_minutes: 5,
    connection_id: "c",
    model: "m",
  });
  expect(db.calls[0]?.sql).not.toContain("revision");
  expect(
    await repository.saveSettings("nobody", {
      limit: 10,
      quietMinutes: 1,
      model: null,
    }),
  ).toBe(false);
  expect(db.calls[1]?.parameters).toMatchObject({
    connection_id: null,
    model: null,
  });
});

it("reads the settings of an agent and answers null for an unknown one", async () => {
  const db = database(
    [[200, 2, null, null, null]],
    [[50, 10, "c", "m", "2026-11-13T17:05:00.000Z"]],
    [],
  );
  const repository = new AgentLogbookRepository(db);
  expect(await repository.settings("ed")).toEqual({
    limit: 200,
    quietMinutes: 2,
    connectionId: null,
    model: null,
    compactionAt: null,
  });
  expect(await repository.settings("ed")).toMatchObject({
    limit: 50,
    connectionId: "c",
    compactionAt: "2026-11-13T17:05:00.000Z",
  });
  expect(await repository.settings("nobody")).toBeNull();
});

it("names the people of a direct chat and of a group without the agent", async () => {
  const db = database([["Igor"]], [["Igor"], ["Mei"]]);
  const repository = new AgentLogbookRepository(db);
  expect(
    await repository.participantNames({ kind: "direct", id: "p" }, "ed"),
  ).toEqual(["Igor"]);
  expect(
    await repository.participantNames({ kind: "group", id: "g" }, "ed"),
  ).toEqual(["Igor", "Mei"]);
  expect(db.calls[1]?.sql).toContain("users.id <> $agent_id");
});

it("lists the chat sessions that had a round after their last summary, never a confidential chat", async () => {
  const db = database([
    [
      "session-team",
      "ed",
      "conversation",
      "group-team",
      "Pages-Team",
      "2026-11-13T17:00:00.000Z",
      10,
      2,
    ],
    [
      "session-igor",
      "ed",
      "chat",
      "person-igor",
      "Igor",
      "2026-11-13T16:00:00.000Z",
      0,
      5,
    ],
  ]);
  const pending = await new AgentLogbookSessionRepository(db).pending();
  expect(pending).toEqual([
    {
      sessionId: "session-team",
      agentId: "ed",
      kind: "group",
      chatId: "group-team",
      chatName: "Pages-Team",
      lastActivityAt: "2026-11-13T17:00:00.000Z",
      through: 10,
      quietMinutes: 2,
    },
    expect.objectContaining({ kind: "direct", quietMinutes: 5 }),
  ]);
  const { sql } = db.calls[0] ?? { sql: "" };
  // A session is due once a round ended after the last summary ...
  expect(sql).toContain("agent_conversations.last_activity_at IS NOT NULL");
  expect(sql).toContain(
    "logbook_processed_at < agent_conversations.last_activity_at",
  );
  // ... only for chats, and never for a confidential one.
  expect(sql).toContain("purpose IN ('chat', 'conversation')");
  expect(sql).toContain("is_confidential");
});

it("remembers the stand of a session and how far its chat was read, moving only forward", async () => {
  const db = database([[4]]);
  const repository = new AgentLogbookSessionRepository(db);
  expect(await repository.seen("session")).toBe(4);
  await repository.saveSeen("session", 9);
  await repository.saveProgress("session", { through: 12, processedAt: null });
  expect(db.calls[1]?.sql).toContain("GREATEST(logbook_seen, $sequence)");
  expect(db.calls[2]?.sql).toContain("GREATEST(logbook_through, $through)");
  expect(db.calls[2]?.sql).toContain(
    "COALESCE($processed_at, logbook_processed_at)",
  );
  expect(db.calls[2]?.parameters).toEqual({
    session_id: "session",
    through: 12,
    processed_at: null,
  });
});

it("stores the model the instance names for the summary without touching the limits' revision", async () => {
  const db = database([["c", "m"]], [], [[1]], []);
  const repository = new AgentSessionSettingsRepository(db);
  expect(await repository.logbookModel()).toEqual({
    connectionId: "c",
    model: "m",
  });
  expect(await repository.logbookModel()).toBeNull();
  await repository.saveLogbookModel({ connectionId: "c2", model: "m2" });
  expect(db.calls[2]?.parameters).toEqual({ connection_id: "c2", model: "m2" });
  expect(db.calls[2]?.sql).not.toContain("revision");
  await repository.saveLogbookModel(null);
  expect(db.calls[3]?.parameters).toEqual({ connection_id: null, model: null });
});
