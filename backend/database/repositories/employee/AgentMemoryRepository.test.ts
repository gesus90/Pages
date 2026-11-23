import { afterEach, expect, it, vi } from "vitest";

import {
  AgentMemoryRepository,
  readMemorySource,
} from "./AgentMemoryRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentMemoryRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentMemoryRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("reads no source for a missing, unreadable or non-object value", () => {
  expect(readMemorySource(null)).toBeNull();
  expect(readMemorySource("{")).toBeNull();
  expect(readMemorySource("5")).toBeNull();
  expect(readMemorySource("null")).toBeNull();
});

it("rethrows an unexpected parse failure", () => {
  vi.spyOn(JSON, "parse").mockImplementation(() => {
    throw new Error("boom");
  });

  expect(() => readMemorySource("{}")).toThrow("boom");
});

it("reads the chat, tickets and wiki pages of a source", () => {
  expect(
    readMemorySource(
      JSON.stringify({
        chat: { kind: "person", personId: "p1" },
        tickets: ["T-1", 3],
        wikiPages: ["w1"],
      }),
    ),
  ).toEqual({
    chat: { kind: "person", personId: "p1" },
    tickets: ["T-1"],
    wikiPages: ["w1"],
  });
  expect(
    readMemorySource(
      JSON.stringify({ chat: { kind: "conversation", conversationId: "c1" } }),
    ),
  ).toEqual({
    chat: { kind: "conversation", conversationId: "c1" },
    tickets: [],
    wikiPages: [],
  });
});

it("reads no chat for an unusable chat value", () => {
  const chats = [
    "x",
    null,
    { kind: "person" },
    { kind: "conversation" },
    { kind: "other" },
  ];
  for (const chat of chats)
    expect(readMemorySource(JSON.stringify({ chat }))?.chat).toBeNull();
});

it("reads the archive with sources", async () => {
  const { repository, query } = doubleOf([
    ["e1", "T", "C", "t1", null],
    ["e2", "T2", "C2", "t2", '{"tickets":["K-1"]}'],
  ]);

  const entries = await repository.archive("u1");

  expect(entries[0]?.source).toBeNull();
  expect(entries[1]?.source?.tickets).toEqual(["K-1"]);
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1" });
});

it("counts archive words with and without a row", async () => {
  expect(await doubleOf([[12]]).repository.archiveWords("u1")).toBe(12);
  expect(await doubleOf([]).repository.archiveWords("u1")).toBe(0);
});

it("searches with escaped terms", async () => {
  const { repository, query } = doubleOf([["e1", "T", "C", "t1", null]]);

  const entries = await repository.search("u1", ["a%b", "c_d\\"], 5);

  expect(entries).toHaveLength(1);
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    limit: 5,
    term_0: "%a\\%b%",
    term_1: "%c\\_d\\\\%",
  });
});

it("searches for any term and skips an empty term list", async () => {
  const { repository, query } = doubleOf([["e1", "T", "C", "t1", null]]);

  expect(await repository.searchAny("u1", [], 5)).toEqual([]);
  expect(query).not.toHaveBeenCalled();
  expect(await repository.searchAny("u1", ["x", "y"], 5)).toHaveLength(1);
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    limit: 5,
    term_0: "%x%",
    term_1: "%y%",
  });
});

it("adds entries with and without optional fields", async () => {
  const { repository, execute } = doubleOf([]);
  const source = { chat: null, tickets: ["K-1"], wikiPages: [] };

  await repository.add("u1", [
    { id: "e1", title: "T", content: "C", wordCount: 1 },
    {
      id: "e2",
      title: "T",
      content: "C",
      wordCount: 2,
      createdAt: "t",
      source,
    },
  ]);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    created_at: null,
    source: null,
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    created_at: "t",
    source: JSON.stringify(source),
  });
});

it("removes entries one by one and clears the archive", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.remove("u1", ["a", "b"]);
  await repository.clear("u1");

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[1]?.[1]).toEqual({ user_id: "u1", id: "b" });
});

it("trims and reports the removed count", async () => {
  const { repository, query } = doubleOf([["a"], ["b"]]);

  expect(await repository.trim("u1", 100)).toBe(2);
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    maximum_words: 100,
  });
});

it("records a version", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.addVersion({
    id: "v1",
    userId: "u1",
    reason: "edit",
    memory: "m",
    dream: "d",
    archive: "[]",
    coreWords: 1,
    archiveWords: 2,
    createdBy: null,
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "v1",
    created_by: null,
    archive_words: 2,
  });
});

it("lists versions of every reason", async () => {
  const { repository } = doubleOf([["v1", "dream", "t", 1, 2]]);

  expect(await repository.versions("u1", 3)).toEqual([
    {
      id: "v1",
      reason: "dream",
      createdAt: "t",
      coreWords: 1,
      archiveWords: 2,
    },
  ]);
});

it("rejects a version with an unsupported reason", async () => {
  const { repository } = doubleOf([["v1", "bogus", "t", 1, 2]]);

  await expect(repository.versions("u1", 3)).rejects.toThrow(
    "unsupported memory version reason",
  );
});

it("finds a version with its content", async () => {
  const { repository } = doubleOf([
    ["v1", "edit", "t", 1, 2, "mem", null, "dr"],
  ]);

  expect(await repository.findVersion("u1", "v1")).toMatchObject({
    memory: "mem",
    archive: "[]",
    dream: "dr",
  });
  expect(
    (
      await doubleOf([
        ["v1", "edit", "t", 1, 2, "mem", "[1]", "dr"],
      ]).repository.findVersion("u1", "v1")
    )?.archive,
  ).toBe("[1]");
});

it("finds no version without a row", async () => {
  expect(await doubleOf([]).repository.findVersion("u1", "v1")).toBeNull();
});

it("prunes versions", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.pruneVersions("u1", 10);

  expect(execute.mock.calls[0]?.[1]).toEqual({ user_id: "u1", keep: 10 });
});
