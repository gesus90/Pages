import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanOneShotRepository } from "./AgentPlanOneShotRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
const query = vi.fn<DatabaseTransaction["query"]>();

function repository(): AgentPlanOneShotRepository {
  return new AgentPlanOneShotRepository({
    query,
    transaction: async (work) => work({ execute, query }),
  });
}

beforeEach(() => {
  execute.mockClear();
  query.mockReset();
});

it("schedules only a plan that carries the mark", async () => {
  query.mockResolvedValueOnce([["p1"]]).mockResolvedValueOnce([]);

  expect(await repository().schedule("p1", "t")).toBe(true);
  expect(await repository().schedule("p2", "t")).toBe(false);
  expect(query.mock.calls[0]?.[1]).toEqual({
    plan_id: "p1",
    deletion_at: "t",
  });
});

it("cancels a scheduled deletion", async () => {
  await repository().cancel("p1");

  expect(execute.mock.calls[0]?.[1]).toEqual({ plan_id: "p1" });
});

it("lists the due plans", async () => {
  query.mockResolvedValueOnce([["a"], ["b"]]);

  expect(await repository().listDue("now")).toEqual(["a", "b"]);
});

it("reads the candidate of a deletion", async () => {
  query
    .mockResolvedValueOnce([["p1", "Name", "u1", "pr1", "t", "true"]])
    .mockResolvedValueOnce([["r"]])
    .mockResolvedValueOnce([["succeeded"]]);

  expect(await repository().findCandidate("p1")).toEqual({
    planId: "p1",
    name: "Name",
    ownerId: "u1",
    projectId: "pr1",
    deletionAt: "t",
    isOneShot: true,
    hasActiveRun: true,
    latestRunStatus: "succeeded",
  });
});

it("reads a candidate without mark, deadline or runs", async () => {
  query
    .mockResolvedValueOnce([["p1", "Name", "u1", "pr1", null, null]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  expect(await repository().findCandidate("p1")).toMatchObject({
    deletionAt: null,
    isOneShot: false,
    hasActiveRun: false,
    latestRunStatus: null,
  });
});

it("returns null for a plan that is gone", async () => {
  query.mockResolvedValueOnce([]);

  expect(await repository().findCandidate("p1")).toBeNull();
});

it("reports a plan that is gone when deleting", async () => {
  query.mockResolvedValueOnce([]);

  expect(await repository().deletePlan("p1")).toBe("gone");
});

it("keeps a plan that is unmarked, unscheduled or has a run", async () => {
  query
    .mockResolvedValueOnce([["p1", "N", "u", "pr", "t", null]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["p1", "N", "u", "pr", null, "true"]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["p1", "N", "u", "pr", "t", "true"]])
    .mockResolvedValueOnce([["r1"]]);

  expect(await repository().deletePlan("p1")).toBe("not_due");
  expect(await repository().deletePlan("p1")).toBe("not_due");
  expect(await repository().deletePlan("p1")).toBe("not_due");
  expect(execute).not.toHaveBeenCalled();
});

it("deletes the plan and logs the owner's name", async () => {
  query
    .mockResolvedValueOnce([["p1", "Plan", "u1", "pr1", "t", "true"]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["Ada"]]);

  expect(await repository().deletePlan("p1")).toBe("deleted");

  const parameters = execute.mock.calls.map((call) => call[1]);
  expect(parameters[0]).toEqual({ plan_id: "p1" });
  expect(parameters[1]).toEqual({ plan_id: "p1" });
  expect(parameters.at(-1)).toMatchObject({
    project_id: "pr1",
    user_id: "u1",
    action: "one_shot_plan_deleted",
    message:
      'Einmal-Plan "Plan" nach erfolgreichem Lauf gelöscht (Eigentümer: Ada).',
  });
});

it("logs a placeholder when the owner no longer exists", async () => {
  query
    .mockResolvedValueOnce([["p1", "Plan", "u1", "pr1", "t", "true"]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  await repository().deletePlan("p1");

  expect(String(execute.mock.calls.at(-1)?.[1]?.message)).toContain(
    "Eigentümer: ?",
  );
});
