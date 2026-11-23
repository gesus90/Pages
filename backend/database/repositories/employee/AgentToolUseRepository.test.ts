import { expect, it, vi } from "vitest";

import { AgentToolUseRepository } from "./AgentToolUseRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function doubleOf(rows: DatabaseValue[][]): {
  repository: AgentToolUseRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentToolUseRepository({
      query,
      execute,
    }),
    query,
    execute,
  };
}

it("appends a call", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.append("a1", {
    tool: "t",
    input: "i",
    output: "o",
    isOk: false,
    error: "e",
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    tool: "t",
    input: "i",
    output: "o",
    is_ok: false,
    error: "e",
  });
});

it("reads the calls after a cursor", async () => {
  const { repository, query } = doubleOf([
    [3n, "at", "t", "i", "o", 1, null],
    [4, "at2", "t2", "i2", "o2", 0, "boom"],
  ]);

  expect(await repository.since("a1", 2, 10)).toEqual([
    {
      id: 3,
      at: "at",
      tool: "t",
      input: "i",
      output: "o",
      isOk: true,
      error: null,
    },
    {
      id: 4,
      at: "at2",
      tool: "t2",
      input: "i2",
      output: "o2",
      isOk: false,
      error: "boom",
    },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    cursor: 2,
    limit: 10,
  });
});

it("lists the tool names", async () => {
  const { repository } = doubleOf([["a"], ["b"]]);

  expect(await repository.toolNames("a1")).toEqual(["a", "b"]);
});

it("prunes old calls", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.prune("a1", "2020-01-01 00:00:00");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    before: "2020-01-01 00:00:00",
  });
});
