import { expect, it, vi } from "vitest";

import { AgentLogbookRepository } from "./AgentLogbookRepository";

import type { NewAgentLogbookEntry } from "./AgentLogbookRepository";
import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentLogbookRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentLogbookRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

function entryRow(overrides: Record<number, unknown> = {}): unknown[] {
  const row: unknown[] = [
    "e1",
    5,
    "a1",
    "decision",
    "text",
    "topic",
    "group",
    "c1",
    "Team",
    '["u1"]',
    "agent",
    "2026-01-01T00:00:00Z",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

const source = { kind: "direct", id: "p1" } as const;

it("appends an entry with serialized participants", async () => {
  const { repository, execute } = doubleOf([]);
  const entry: NewAgentLogbookEntry = {
    id: "e1",
    agentId: "a1",
    kind: "fact",
    text: "t",
    topic: "o",
    source: { kind: "group", id: "c1", name: "Team" },
    participants: ["u1"],
    origin: "background",
    createdAt: "now",
  };

  await repository.append(entry);

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "e1",
    agent_id: "a1",
    kind: "fact",
    text: "t",
    topic: "o",
    source_kind: "group",
    source_id: "c1",
    source_name: "Team",
    participants: '["u1"]',
    origin: "background",
    created_at: "now",
  });
});

it("trims to the limit and counts the dropped entries", async () => {
  const { repository } = doubleOf([["a"], ["b"]]);

  expect(await repository.trimToLimit("a1", 10)).toBe(2);
});

it("counts entries and finds the newest sequence", async () => {
  expect(await doubleOf([[4]]).repository.count("a1")).toBe(4);
  expect(await doubleOf([]).repository.count("a1")).toBe(0);
  expect(await doubleOf([[9]]).repository.newestSequence("a1")).toBe(9);
  expect(await doubleOf([]).repository.newestSequence("a1")).toBe(0);
});

it("finds entries with words and a chat filter", async () => {
  const { repository, query } = doubleOf([
    entryRow(),
    entryRow({ 3: "open", 6: "direct", 10: "background" }),
    entryRow({ 3: "fact" }),
    entryRow({ 3: "question" }),
    entryRow({ 3: "whatever" }),
  ]);

  const entries = await repository.find("a1", {
    words: ["a%b", "c", "d", "e", "f", "g", "h"],
    chat: "Te_am",
    limit: 5,
  });

  expect(entries.map((entry) => entry.kind)).toEqual([
    "decision",
    "open",
    "fact",
    "question",
    "note",
  ]);
  expect(entries[0]).toMatchObject({
    source: { kind: "group", id: "c1", name: "Team" },
    participants: ["u1"],
    origin: "agent",
  });
  expect(entries[1]).toMatchObject({
    source: { kind: "direct" },
    origin: "background",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    limit: 5,
    word_0: "%a\\%b%",
    word_1: "%c%",
    word_2: "%d%",
    word_3: "%e%",
    word_4: "%f%",
    word_5: "%g%",
    chat: "%te\\_am%",
  });
});

it("finds entries without words or chat", async () => {
  const { repository, query } = doubleOf([]);

  expect(
    await repository.find("a1", { words: [], chat: null, limit: 2 }),
  ).toEqual([]);
  expect(query.mock.calls[0]?.[1]).toEqual({ agent_id: "a1", limit: 2 });
});

it("reads entries for dreaming, of a chat and by id", async () => {
  const { repository, query } = doubleOf([entryRow()]);

  expect(
    await repository.forDreaming("a1", { after: 3, limit: 4 }),
  ).toHaveLength(1);
  expect(await repository.ofChat("a1", source, 6)).toHaveLength(1);
  expect(await repository.byIds("a1", ["e1", "e2"])).toHaveLength(1);
  expect(query.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    after: 3,
    limit: 4,
  });
  expect(query.mock.calls[1]?.[1]).toEqual({
    agent_id: "a1",
    source_kind: "direct",
    source_id: "p1",
    limit: 6,
  });
  expect(query.mock.calls[2]?.[1]).toEqual({
    agent_id: "a1",
    id_0: "e1",
    id_1: "e2",
  });
});

it("reads no entries for an empty id list", async () => {
  const { repository, query } = doubleOf([]);

  expect(await repository.byIds("a1", [])).toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("reads the participant names of direct and group chats", async () => {
  const { repository, query } = doubleOf([["Ann"], ["Bob"]]);

  expect(await repository.participantNames(source, "a1")).toEqual([
    "Ann",
    "Bob",
  ]);
  expect(
    await repository.participantNames({ kind: "group", id: "c1" }, "a1"),
  ).toEqual(["Ann", "Bob"]);
  expect(query.mock.calls[0]?.[1]).toEqual({ chat_id: "p1" });
  expect(query.mock.calls[1]?.[1]).toEqual({ chat_id: "c1", agent_id: "a1" });
});

it("reads news since a stand", async () => {
  const { repository } = doubleOf([
    [7, "one"],
    [7, "two"],
  ]);

  expect(await repository.newSince("a1", 2, source, 2)).toEqual({
    count: 7,
    topics: ["one", "two"],
  });
  expect(await doubleOf([]).repository.newSince("a1", 2, source, 2)).toEqual({
    count: 0,
    topics: [],
  });
});

it("removes entries by id", async () => {
  const { repository, query } = doubleOf([["a"], ["b"]]);

  expect(await repository.remove("a1", [])).toBe(0);
  expect(query).not.toHaveBeenCalled();
  expect(await repository.remove("a1", ["a", "b"])).toBe(2);
  expect(query.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    id_0: "a",
    id_1: "b",
  });
});

it("removes a chat for one agent or all", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.removeChat(source, "a1");
  await repository.removeChat(source, null);

  expect(execute.mock.calls[0]?.[1]).toEqual({
    source_kind: "direct",
    source_id: "p1",
    agent_id: "a1",
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ agent_id: null });
});

it("reads the settings of an agent", async () => {
  expect(
    await doubleOf([[50, 10, "c1", "m1", "t"]]).repository.settings("a1"),
  ).toEqual({
    limit: 50,
    quietMinutes: 10,
    connectionId: "c1",
    model: "m1",
    compactionAt: "t",
  });
  expect(await doubleOf([]).repository.settings("a1")).toBeNull();
});

it("saves the settings with and without a model", async () => {
  const withModel = doubleOf([["a1"]]);
  const without = doubleOf([]);

  expect(
    await withModel.repository.saveSettings("a1", {
      limit: 1,
      quietMinutes: 2,
      model: { connectionId: "c1", model: "m1" },
    }),
  ).toBe(true);
  expect(
    await without.repository.saveSettings("a1", {
      limit: 1,
      quietMinutes: 2,
      model: null,
    }),
  ).toBe(false);
  expect(withModel.query.mock.calls[0]?.[1]).toMatchObject({
    connection_id: "c1",
    model: "m1",
  });
  expect(without.query.mock.calls[0]?.[1]).toMatchObject({
    connection_id: null,
    model: null,
  });
});

it("records the compaction time", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.saveCompactionAt("a1", "t");

  expect(execute.mock.calls[0]?.[1]).toEqual({ agent_id: "a1", at: "t" });
});
