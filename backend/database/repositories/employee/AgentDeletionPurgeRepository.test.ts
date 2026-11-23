import { expect, it, vi } from "vitest";

import { AgentDeletionPurgeRepository } from "./AgentDeletionPurgeRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(queue: (readonly (readonly DatabaseValue[])[])[]): {
  repository: AgentDeletionPurgeRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => queue.shift() ?? []);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentDeletionPurgeRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

it("lists expired agents", async () => {
  const { repository, query } = doubleOf([[["a1"], ["a2"]]]);

  expect(await repository.expired("now")).toEqual(["a1", "a2"]);
  expect(query.mock.calls[0]?.[1]).toEqual({ now: "now" });
});

it("purges an agent and returns the queued files", async () => {
  const { repository, execute } = doubleOf([
    [["s1"]],
    [
      ["chat", "c1"],
      ["plan", "p1"],
      ["voice", "v1"],
    ],
  ]);

  const result = await repository.purge("a1", "now", "e1");

  expect(result.entries).toEqual([
    { kind: "session", name: "s1" },
    { kind: "chat", name: "c1" },
    { kind: "plan", name: "p1" },
    { kind: "voice", name: "v1" },
  ]);
  const parameters = execute.mock.calls.map((call) => call[1]);
  expect(parameters[0]).toEqual({ kind: "session", name: "s1" });
  expect(parameters.at(-2)).toEqual({
    agent_id: "a1",
    now: "now",
    event_id: "e1",
  });
  expect(parameters.at(-1)).toEqual({ agent_id: "a1", now: "now" });
});

it("purges an agent without files", async () => {
  const { repository } = doubleOf([[], []]);

  expect((await repository.purge("a1", "now", "e1")).entries).toEqual([]);
});

it("rejects an unknown queued file kind", async () => {
  const { repository } = doubleOf([[], [["video", "x"]]]);

  await expect(repository.purge("a1", "now", "e1")).rejects.toThrow(
    "Unknown agent deletion file kind.",
  );
});

it("reads pending files", async () => {
  const { repository } = doubleOf([[["session", "s1"]]]);

  expect(await repository.pendingFiles()).toEqual({
    entries: [{ kind: "session", name: "s1" }],
  });
});

it("acknowledges a removed file", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.acknowledgeFile("chat", "c1");

  expect(execute.mock.calls[0]?.[1]).toEqual({ kind: "chat", name: "c1" });
});
