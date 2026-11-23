import { expect, it, vi } from "vitest";

import { AgentChatSessionRepository } from "./AgentChatSessionRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentChatSessionRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentChatSessionRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

const FULL_ROW = [
  "s",
  "a",
  "chat",
  "p",
  "Pat",
  1,
  5n,
  0,
  10,
  100,
  7,
  3,
  "d",
  2,
  "t",
];
const EMPTY_ROW = [
  "s",
  "a",
  "conversation",
  "g",
  "",
  0,
  0,
  1,
  null,
  null,
  0,
  0,
  null,
  0,
  null,
];

it("maps a session row with counts and a direct chat", async () => {
  const { repository } = doubleOf([FULL_ROW]);

  expect(await repository.list("a")).toEqual([
    {
      sessionId: "s",
      agentId: "a",
      kind: "direct",
      chatId: "p",
      chatName: "Pat",
      isConfidential: true,
      deliveredSequence: 5,
      needsRestart: false,
      contextUsed: 10,
      contextSize: 100,
      tokensTotal: 7,
      tokensToday: 3,
      tokensDay: "d",
      restartCount: 2,
      lastActivityAt: "t",
    },
  ]);
});

it("maps a group session with empty optional values", async () => {
  const { repository } = doubleOf([EMPTY_ROW]);

  expect(await repository.forChat("group", "g")).toMatchObject([
    {
      kind: "group",
      needsRestart: true,
      contextUsed: null,
      contextSize: null,
      tokensDay: null,
      lastActivityAt: null,
    },
  ]);
});

it("selects the purpose by chat kind", async () => {
  const { repository, query } = doubleOf([]);

  await repository.forChat("direct", "p");
  await repository.forChat("group", "g");

  expect(query.mock.calls[0]?.[1]).toEqual({ chat_id: "p", purpose: "chat" });
  expect(query.mock.calls[1]?.[1]).toEqual({
    chat_id: "g",
    purpose: "conversation",
  });
});

it("finds a session or nothing", async () => {
  expect((await doubleOf([FULL_ROW]).repository.find("s"))?.sessionId).toBe(
    "s",
  );
  expect(await doubleOf([]).repository.find("s")).toBeNull();
});

it("reads the delivered sequence, defaulting to zero", async () => {
  expect(await doubleOf([[4]]).repository.delivered("s")).toBe(4);
  expect(await doubleOf([]).repository.delivered("s")).toBe(0);
});

it("writes session state", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.saveDelivered("s", 3);
  await repository.recordUsage("s", {
    contextUsed: null,
    contextSize: 9,
    tokens: 4,
    day: "d",
    at: "t",
  });
  await repository.setNeedsRestart("s", true);
  await repository.markRestarted("s", "t");
  await repository.remove("s");

  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { session_id: "s", sequence: 3 },
    {
      session_id: "s",
      context_used: null,
      context_size: 9,
      tokens: 4,
      day: "d",
      at: "t",
    },
    { session_id: "s", needs_restart: true },
    { session_id: "s", at: "t" },
    { session_id: "s" },
  ]);
});

it("sums the tokens of a day, defaulting to zero", async () => {
  expect(await doubleOf([[12]]).repository.tokensOn("a", "d")).toBe(12);
  expect(await doubleOf([]).repository.tokensOn("a", "d")).toBe(0);
});

it("reads the settings of an agent", async () => {
  expect(await doubleOf([[15, 80]]).repository.settings("a")).toEqual({
    idleMinutes: 15,
    restartPercent: 80,
  });
  expect(await doubleOf([[null, 80]]).repository.settings("a")).toEqual({
    idleMinutes: null,
    restartPercent: 80,
  });
  expect(await doubleOf([]).repository.settings("a")).toBeNull();
});

it("saves settings and reports whether the agent exists", async () => {
  const found = doubleOf([["a"]]);

  expect(
    await found.repository.saveSettings("a", {
      idleMinutes: 5,
      restartPercent: 70,
    }),
  ).toBe(true);
  expect(found.query.mock.calls[0]?.[1]).toEqual({
    agent_id: "a",
    idle_minutes: 5,
    restart_percent: 70,
  });
  expect(
    await doubleOf([]).repository.saveSettings("a", {
      idleMinutes: 5,
      restartPercent: 70,
    }),
  ).toBe(false);
});
