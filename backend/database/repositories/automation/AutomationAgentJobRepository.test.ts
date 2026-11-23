import { expect, it, vi } from "vitest";

import { AutomationAgentJobRepository } from "./AutomationAgentJobRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AutomationAgentJobRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AutomationAgentJobRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

const JOB_ROW: (string | null)[] = [
  "j1",
  "r1",
  "a1",
  "agent",
  "u1",
  "action",
  "do it",
  "completed",
  "done",
  "E",
  "s1",
  "q",
  "d",
  "c",
];

it("enqueues a delivery and reports whether it was added", async () => {
  const added = doubleOf([["j1"]]);
  const duplicate = doubleOf([]);
  const request = {
    id: "j1",
    runId: "r1",
    automationId: "a1",
    agentId: "agent",
    creatorId: "u1",
    kind: "action",
    prompt: "p",
    queuedAt: "q",
  } as const;

  expect(await added.repository.enqueue(request)).toBe(true);
  expect(await duplicate.repository.enqueue(request)).toBe(false);
  expect(added.query.mock.calls[0]?.[1]).toMatchObject({
    automation_run_id: "r1",
    agent_id: "agent",
  });
});

it("maps the head, interrupted and run deliveries", async () => {
  const { repository } = doubleOf([JOB_ROW]);
  const expected = {
    id: "j1",
    runId: "r1",
    automationId: "a1",
    agentId: "agent",
    creatorId: "u1",
    kind: "action",
    prompt: "do it",
    state: "completed",
    answer: "done",
    errorCode: "E",
    sessionId: "s1",
    queuedAt: "q",
    deliveredAt: "d",
    completedAt: "c",
  };

  expect(await repository.heads()).toEqual([expected]);
  expect(await repository.interrupted()).toEqual([expected]);
  expect(await repository.forRuns(["r1", "r2"])).toEqual([expected]);
});

it("passes the run ids as one list", async () => {
  const { repository, query } = doubleOf([]);

  await repository.forRuns(["r1", "r2"]);

  expect(query.mock.calls[0]?.[1]).toEqual({ automation_run_ids: "r1,r2" });
});

it("reads no deliveries for no runs", async () => {
  const { repository, query } = doubleOf([JOB_ROW]);

  expect(await repository.forRuns([])).toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("falls back for unknown kind and state and keeps nulls", async () => {
  const row = [...JOB_ROW];
  row[1] = null;
  row[2] = null;
  row[5] = "weird";
  row[7] = "weird";
  const { repository } = doubleOf([row]);

  const [job] = await repository.heads();

  expect(job).toMatchObject({
    runId: null,
    automationId: null,
    kind: "action",
    state: "failed",
  });
});

it("delivers a waiting job only once", async () => {
  const first = doubleOf([["j1"]]);
  const second = doubleOf([]);

  expect(await first.repository.deliver("j1", "s1", "d")).toBe(true);
  expect(await second.repository.deliver("j1", null, "d")).toBe(false);
  expect(first.query.mock.calls[0]?.[1]).toEqual({
    id: "j1",
    session_id: "s1",
    delivered_at: "d",
  });
});

it("finishes a job and prunes ended jobs", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.finish("j1", {
    state: "failed",
    answer: null,
    errorCode: "E",
    completedAt: "c",
  });
  await repository.pruneEnded("b");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "j1",
    state: "failed",
    answer: null,
    error_code: "E",
    completed_at: "c",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({ before: "b" });
});
