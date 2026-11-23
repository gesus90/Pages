import { expect, it, vi } from "vitest";

import { AgentEmployeeRemovalRepository } from "./AgentEmployeeRemovalRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(queue: (readonly (readonly DatabaseValue[])[])[]): {
  repository: AgentEmployeeRemovalRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => queue.shift() ?? []);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentEmployeeRemovalRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

it("reports a running chat job or plan run", async () => {
  const { repository, query } = doubleOf([[[1n, 0]]]);

  expect(await repository.isRunning("a1")).toBe(true);
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "a1" });
});

it("reports a running plan run alone", async () => {
  const { repository } = doubleOf([[[0, 2]]]);

  expect(await repository.isRunning("a1")).toBe(true);
});

it("reports an idle agent", async () => {
  const { repository } = doubleOf([[[0, 0]]]);

  expect(await repository.isRunning("a1")).toBe(false);
});

it("reports an idle agent when no row returns", async () => {
  const { repository } = doubleOf([[]]);

  expect(await repository.isRunning("a1")).toBe(false);
});

it("reads everything that still refers to the agent", async () => {
  const { repository } = doubleOf([
    [[3n]],
    [["g1", "Group"]],
    [[5]],
    [["t1", "PG-1", "Title"]],
    [["p1", "Project"]],
    [["pl1", "Plan"]],
  ]);

  expect(await repository.usages("a1")).toEqual({
    chatLists: 3,
    groups: [{ id: "g1", name: "Group" }],
    ticketCount: 5,
    tickets: [{ id: "t1", key: "PG-1", title: "Title" }],
    projects: [{ id: "p1", name: "Project" }],
    plans: [{ id: "pl1", name: "Plan" }],
  });
});

it("reads zero counts when the count rows are missing", async () => {
  const { repository } = doubleOf([[], [], [], [], [], []]);

  expect(await repository.usages("a1")).toEqual({
    chatLists: 0,
    groups: [],
    ticketCount: 0,
    tickets: [],
    projects: [],
    plans: [],
  });
});

it("removes the agent and tombstones its account", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.remove("a1");

  const calls = execute.mock.calls;
  expect(calls.length).toBeGreaterThan(2);
  expect(calls.at(-1)?.[1]).toEqual({
    user_id: "a1",
    tombstone: "removed-agent-a1",
  });
  expect(calls[0]?.[1]).toEqual({ user_id: "a1" });
});
