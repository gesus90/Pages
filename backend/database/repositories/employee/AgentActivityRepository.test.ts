import { expect, it, vi } from "vitest";

import { AgentActivityRepository } from "./AgentActivityRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(...results: unknown[][][]): {
  repository: AgentActivityRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => results.shift() ?? []);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentActivityRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

it("records an event", async () => {
  const { repository, execute } = doubleOf();

  await repository.record("u", {
    id: "e",
    kind: "access",
    detail: "d",
    cost: { state: "none", amount: null, isEstimated: false },
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "e",
    user_id: "u",
    kind: "access",
    detail: "d",
    cost_amount: null,
    cost_state: "none",
  });
});

it("maps events with known, unknown and no cost", async () => {
  const { repository } = doubleOf([
    ["1", "image", "d", 1.5, "known", "t"],
    ["2", "video", "d", null, "unknown", "t"],
    ["3", "audio", "d", null, "none", "t"],
    ["4", "access", "d", null, "known", "t"],
    ["5", "administrator_granted", "d", null, "none", "t"],
    ["6", "administrator_revoked", "d", null, "none", "t"],
    ["7", "other", "d", null, "none", "t"],
  ]);

  const events = await repository.events("u", 10);

  expect(events.map((event) => event.kind)).toEqual([
    "image",
    "video",
    "audio",
    "access",
    "administrator_granted",
    "administrator_revoked",
    "learning",
  ]);
  expect(events[0]?.cost).toEqual({
    state: "known",
    amount: 1.5,
    isEstimated: false,
  });
  expect(events[1]?.cost.state).toBe("unknown");
  expect(events[2]?.cost.state).toBe("none");
  expect(events[3]?.cost).toEqual({
    state: "none",
    amount: null,
    isEstimated: false,
  });
});

it("maps sessions with their purpose and cost", async () => {
  const { repository } = doubleOf([
    ["1", "learning", null, "done", "t", 2, "USD", 1],
    ["2", "memory", null, "done", "t", 2, "USD", 0],
    ["3", "chat", "Pat", "done", "t", 2, "EUR", 0],
    ["4", "chat", "Pat", "done", "t", null, null, 0],
  ]);

  const sessions = await repository.sessions("u", 10);

  expect(sessions.map((session) => session.purpose)).toEqual([
    "learning",
    "learning",
    "chat",
    "chat",
  ]);
  expect(sessions[0]?.cost).toEqual({
    state: "known",
    amount: 2,
    isEstimated: true,
  });
  expect(sessions[1]?.cost.isEstimated).toBe(false);
  expect(sessions[2]).toMatchObject({
    personName: "Pat",
    cost: { state: "unknown", amount: null },
  });
  expect(sessions[3]?.cost.state).toBe("unknown");
});

it("adds the plan costs to the job costs", async () => {
  const { repository, query } = doubleOf([[4.5, 2]], [[1.25, 1]]);

  expect(await repository.costSince("u", "t")).toEqual({
    known: 5.75,
    unknownSessions: 3,
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u", since: "t" });
});

it("counts nothing for a missing or non-numeric total", async () => {
  expect(await doubleOf([], []).repository.costSince("u", "t")).toEqual({
    known: 0,
    unknownSessions: 0,
  });
  expect(
    await doubleOf([[null, 0]], [[0, 0]]).repository.costSince("u", "t"),
  ).toEqual({ known: 0, unknownSessions: 0 });
});

it("maps ticket and wiki changes", async () => {
  const { repository } = doubleOf([
    ["1", "wiki", "m", "p", null, "w", "t"],
    ["2", "tasks", "m", "p", "K-1", null, "t"],
  ]);

  expect(await repository.changes("u", 5)).toEqual([
    {
      id: "1",
      kind: "wiki",
      message: "m",
      projectId: "p",
      workItemKey: null,
      wikiPageId: "w",
      createdAt: "t",
    },
    {
      id: "2",
      kind: "ticket",
      message: "m",
      projectId: "p",
      workItemKey: "K-1",
      wikiPageId: null,
      createdAt: "t",
    },
  ]);
});
