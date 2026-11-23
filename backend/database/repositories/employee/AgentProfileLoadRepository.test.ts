import { expect, it, vi } from "vitest";

import { AgentProfileLoadRepository } from "./AgentProfileLoadRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentProfileLoadRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  return {
    repository: new AgentProfileLoadRepository({
      query,
    } as unknown as Database),
    query,
  };
}

it("groups projects by user", async () => {
  const { repository } = doubleOf([
    ["u1", "p1", "Alpha", "owner"],
    ["u1", "p2", "Beta", "member"],
    ["u2", "p1", "Alpha", "member"],
  ]);

  const projects = await repository.projectsByUser();

  expect(projects.get("u1")).toEqual([
    { id: "p1", name: "Alpha", role: "owner" },
    { id: "p2", name: "Beta", role: "member" },
  ]);
  expect(projects.get("u2")).toEqual([
    { id: "p1", name: "Alpha", role: "member" },
  ]);
});

it("counts active chats and open tickets by user", async () => {
  const { repository } = doubleOf([
    ["u1", 2],
    ["u2", 1],
  ]);

  expect(await repository.activeChats()).toEqual(
    new Map([
      ["u1", 2],
      ["u2", 1],
    ]),
  );
  expect(await repository.openTicketCounts()).toEqual(
    new Map([
      ["u1", 2],
      ["u2", 1],
    ]),
  );
});

it("groups running steps by user", async () => {
  const { repository } = doubleOf([
    ["u1", "pl1", "r1", "s1"],
    ["u1", "pl1", "r1", "s2"],
  ]);

  const steps = await repository.runningSteps();

  expect(steps.get("u1")).toEqual([
    { planId: "pl1", runId: "r1", stepId: "s1" },
    { planId: "pl1", runId: "r1", stepId: "s2" },
  ]);
});

it("lists open tickets of one user with a limit", async () => {
  const { repository, query } = doubleOf([["i1", "K-1", "Title"]]);

  expect(await repository.openTickets("u1")).toEqual([
    { id: "i1", key: "K-1", title: "Title" },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1", limit: 200 });
});

it("reads last activity and skips users without a time", async () => {
  const { repository } = doubleOf([
    ["u1", "2026-01-01T10:00:00"],
    ["u2", null],
  ]);

  expect(await repository.lastActivity()).toEqual(
    new Map([["u1", "2026-01-01T10:00:00Z"]]),
  );
});
