import { afterEach, expect, it, vi } from "vitest";

import { AgentLearningSourceRepository } from "./AgentLearningSourceRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

type Rows = (readonly (readonly DatabaseValue[])[])[];

function doubleOf(queue: Rows): {
  repository: AgentLearningSourceRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => queue.shift() ?? []);
  return {
    repository: new AgentLearningSourceRepository({
      query,
    } as unknown as Database),
    query,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("reads every source oldest first from the beginning", async () => {
  const { repository, query } = doubleOf([
    [
      ["2026-01-05 00:00:00", "user", "hi", "Eva"],
      ["2026-01-06 00:00:00", "assistant", "hello", "Eva"],
    ],
    [
      ["2026-01-04T00:00:00.000Z", "", "Bob", "msg", "u2"],
      ["2026-01-03T00:00:00.000Z", "Team", "Bob", "own", "a1"],
    ],
    [
      ["2026-01-02 00:00:00", "Proj", "Ann", "did"],
      ["2026-01-02 00:00:01", "Proj", null, "auto"],
    ],
    [["2026-01-01 00:00:00", "Group", "PG-1", "Title"]],
    [
      ["2026-01-07T00:00:00.000Z", "Proj", "done", null],
      ["2026-01-08T00:00:00.000Z", "Proj", "failed", '{"summary":"s"}'],
    ],
  ]);

  const sources = await repository.read("a1", { since: null, limit: 10 });

  expect(sources.map((source) => source.at)).toEqual([
    "2026-01-01 00:00:00",
    "2026-01-02 00:00:00",
    "2026-01-02 00:00:01",
    "2026-01-03 00:00:00",
    "2026-01-04 00:00:00",
    "2026-01-05 00:00:00",
    "2026-01-06 00:00:00",
    "2026-01-07 00:00:00",
    "2026-01-08 00:00:00",
  ]);
  expect(sources.map((source) => source.origin)).toEqual([
    "Group",
    "Proj · Ann",
    "Proj",
    "→ Team · Bob",
    "Bob",
    "Eva",
    "→ Eva",
    "Proj",
    "Proj",
  ]);
  expect(sources[0]).toEqual({
    kind: "group",
    at: "2026-01-01 00:00:00",
    origin: "Group",
    text: "PG-1: Title",
  });
  expect(sources.at(-1)?.text).toBe("failed: s");
  expect(query.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    since: "0000-00-00 00:00:00",
    limit: 10,
  });
  expect(query.mock.calls[1]?.[1]).toMatchObject({
    since: "0000-00-00T00:00:00",
  });
});

it("passes a given start time on", async () => {
  const { repository, query } = doubleOf([]);

  await repository.read("a1", { since: "2026-01-01 10:00:00", limit: 3 });

  expect(query.mock.calls[0]?.[1]).toMatchObject({
    since: "2026-01-01 10:00:00",
  });
  expect(query.mock.calls[4]?.[1]).toMatchObject({
    since: "2026-01-01T10:00:00",
  });
});

it("describes plan reports of every shape", async () => {
  const report = (value: string | null): DatabaseValue[] => [
    "2026-01-01T00:00:00.000Z",
    "P",
    "done",
    value,
  ];
  const { repository } = doubleOf([
    [],
    [],
    [],
    [],
    [
      report('{"message":"m"}'),
      report('{"summary":"","message":"m2"}'),
      report("{}"),
      report("5"),
      report("null"),
      report("{broken"),
    ],
  ]);

  const texts = (await repository.read("a1", { since: null, limit: 9 })).map(
    (source) => source.text,
  );

  expect(texts.sort()).toEqual([
    "done",
    "done",
    "done",
    "done",
    "done: m",
    "done: m2",
  ]);
});

it("rethrows an unexpected report parse failure", async () => {
  vi.spyOn(JSON, "parse").mockImplementation(() => {
    throw new Error("unexpected");
  });
  const { repository } = doubleOf([
    [],
    [],
    [],
    [],
    [["2026-01-01T00:00:00.000Z", "P", "done", "{}"]],
  ]);

  await expect(
    repository.read("a1", { since: null, limit: 1 }),
  ).rejects.toThrow("unexpected");
});
