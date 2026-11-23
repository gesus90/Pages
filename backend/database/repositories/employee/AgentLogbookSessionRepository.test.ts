import { expect, it, vi } from "vitest";

import { AgentLogbookSessionRepository } from "./AgentLogbookSessionRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentLogbookSessionRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentLogbookSessionRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

it("reads the seen sequence of a session", async () => {
  const { repository, query } = doubleOf([[7]]);

  expect(await repository.seen("s1")).toBe(7);
  expect(query.mock.calls[0]?.[1]).toEqual({ session_id: "s1" });
});

it("reports zero for a session without a row", async () => {
  const { repository } = doubleOf([]);

  expect(await repository.seen("s1")).toBe(0);
});

it("saves the seen sequence", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.saveSeen("s1", 4);

  expect(execute.mock.calls[0]?.[1]).toEqual({ session_id: "s1", sequence: 4 });
});

it("lists pending sessions of both kinds", async () => {
  const { repository } = doubleOf([
    ["s1", "a1", "chat", "p1", "Ann", "t1", 3, 10],
    ["s2", "a1", "conversation", "c1", "Team", null, 0, 5],
  ]);

  expect(await repository.pending()).toEqual([
    {
      sessionId: "s1",
      agentId: "a1",
      kind: "direct",
      chatId: "p1",
      chatName: "Ann",
      lastActivityAt: "t1",
      through: 3,
      quietMinutes: 10,
    },
    {
      sessionId: "s2",
      agentId: "a1",
      kind: "group",
      chatId: "c1",
      chatName: "Team",
      lastActivityAt: "",
      through: 0,
      quietMinutes: 5,
    },
  ]);
});

it("saves progress with and without a processed time", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.saveProgress("s1", { through: 9, processedAt: "t" });
  await repository.saveProgress("s1", { through: 2, processedAt: null });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    session_id: "s1",
    through: 9,
    processed_at: "t",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    session_id: "s1",
    through: 2,
    processed_at: null,
  });
});
