import { beforeEach, expect, it, vi } from "vitest";

import type { Database } from "@/backend/database/Database";
import { AgentRunFailureRepository } from "./AgentRunFailureRepository";

import type {
  IndexedFailure,
  RunFailureIndexEntry,
  RunSearchFilters,
} from "./AgentRunFailureRepository";

const readPlanRun = vi.hoisted(() => vi.fn());
const logCaughtError = vi.hoisted(() => vi.fn());

vi.mock("@/backend/agents/AgentPlanRunInput", () => ({ readPlanRun }));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError }));

function doubleOf(...answers: unknown[][][]): {
  repository: AgentRunFailureRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const answer of answers) query.mockResolvedValueOnce(answer);
  query.mockResolvedValue([]);
  const execute = vi.fn(async () => undefined);
  const transaction = vi.fn(
    async (work: (transaction: unknown) => Promise<unknown>) =>
      work({ execute }),
  );
  return {
    repository: new AgentRunFailureRepository({
      query,
      transaction,
    } as unknown as Pick<Database, "query" | "transaction">),
    query,
    execute,
  };
}

const NO_FILTERS: RunSearchFilters = {
  planIds: ["p1", "p2"],
  projectId: null,
  planId: null,
  status: null,
  stepId: null,
  errorClass: null,
  startedById: null,
  from: null,
  to: null,
};
const ALL_FILTERS: RunSearchFilters = {
  planIds: ["p1"],
  projectId: "pr",
  planId: "p1",
  status: "failed",
  stepId: "s1",
  errorClass: "timeout",
  startedById: "u1",
  from: "f",
  to: "t",
};

beforeEach(() => {
  readPlanRun.mockReset();
  logCaughtError.mockReset();
});

it("lists the runs whose failures are pending", async () => {
  const { repository, query } = doubleOf([["r2"], ["r1"]]);

  await expect(repository.pending("since", 10)).resolves.toEqual(["r2", "r1"]);
  expect(query.mock.calls[0]?.[1]).toEqual({ since: "since", limit: 10 });
});

it("loads a run to index", async () => {
  readPlanRun.mockReturnValue({ id: "run" });
  const { repository } = doubleOf([["{}", 3, "p1", "pr", "u1"]]);

  await expect(repository.load("r1")).resolves.toEqual({
    run: { id: "run" },
    revision: 3,
    runId: "r1",
    planId: "p1",
    projectId: "pr",
    startedById: "u1",
  });
});

it("loads a damaged run without a view and logs it", async () => {
  const { repository } = doubleOf([["not json", 1, "p1", "pr", "u1"]]);

  const loaded = await repository.load("r1");

  expect(loaded?.run).toBeNull();
  expect(logCaughtError).toHaveBeenCalledOnce();
});

it("loads nothing for an unknown run", async () => {
  await expect(doubleOf([]).repository.load("r1")).resolves.toBeNull();
});

const FAILURE: IndexedFailure = {
  stepId: "s1",
  stepLabel: "Step",
  loopId: "l1",
  iteration: 2,
  attemptId: "a1",
  errorClass: "timeout",
  errorCode: "x",
  occurredAt: "2026-01-01",
};
const ENTRY: RunFailureIndexEntry = {
  runId: "r1",
  revision: 4,
  planId: "p1",
  planName: "Plan",
  projectId: "pr",
  startedById: "u1",
  endedAt: null,
  failedStepId: "s1",
  errorClass: "timeout",
  errorCode: "x",
  failures: [FAILURE, { ...FAILURE, loopId: null, iteration: null }],
};

it("replaces the failures of a run and its index entry", async () => {
  const { repository, execute } = doubleOf();

  await repository.replace(ENTRY);

  expect(execute).toHaveBeenCalledTimes(4);
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    failure_key: "l1/2/s1",
  });
  expect(execute.mock.calls[2]?.[1]).toMatchObject({ failure_key: "/0/s1" });
  expect(execute.mock.calls[3]?.[1]).toMatchObject({
    run_id: "r1",
    revision: 4,
    plan_name: "Plan",
  });
});

it("counts matching runs", async () => {
  const { repository, query } = doubleOf([[7]]);

  await expect(repository.count(ALL_FILTERS)).resolves.toBe(7);
  expect(query.mock.calls[0]?.[1]).toEqual({
    plan_0: "p1",
    project_id: "pr",
    plan_id_filter: "p1",
    status: "failed",
    started_by_id: "u1",
    from_at: "f",
    to_at: "t",
    failure_step_id: "s1",
    failure_class: "timeout",
  });
  await expect(doubleOf().repository.count(NO_FILTERS)).resolves.toBe(0);
});

it("filters runs by a failed step only or a class only", async () => {
  const step = doubleOf();
  const errorClass = doubleOf();

  await step.repository.count({ ...NO_FILTERS, stepId: "s1" });
  await errorClass.repository.count({ ...NO_FILTERS, errorClass: "git" });

  expect(step.query.mock.calls[0]?.[1]).toEqual({
    plan_0: "p1",
    plan_1: "p2",
    failure_step_id: "s1",
  });
  expect(errorClass.query.mock.calls[0]?.[1]).toMatchObject({
    failure_class: "git",
  });
});

it("matches no plan when none may be seen", async () => {
  const { repository, query } = doubleOf();

  await repository.count({ ...NO_FILTERS, planIds: [] });

  expect(query.mock.calls[0]?.[0]).toContain("IN (NULL)");
});

it("searches a window of runs", async () => {
  const { repository, query } = doubleOf([
    ["r1", "p1", "Plan", "pr", "failed", "s", "e", "u1", "s1", "timeout", "x"],
    ["r2", "p1", "p1", "pr", "running", "s", null, "u1", null, "nope", null],
  ]);

  const rows = await repository.search(NO_FILTERS, { offset: 5, limit: 2 });

  expect(rows[0]).toEqual({
    runId: "r1",
    planId: "p1",
    planName: "Plan",
    projectId: "pr",
    status: "failed",
    startedAt: "s",
    endedAt: "e",
    startedById: "u1",
    failedStepId: "s1",
    errorClass: "timeout",
    errorCode: "x",
  });
  expect(rows[1]).toMatchObject({ endedAt: null, errorClass: null });
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    window_limit: 2,
    window_offset: 5,
  });
});

it("groups the failures by each grouping", async () => {
  const row = [
    "timeout",
    "p1",
    "Plan",
    "s1",
    "Step",
    3,
    "first",
    "last",
    "r1,r2,r1",
  ];
  const byClass = doubleOf([row]);
  const byPlan = doubleOf();
  const byStep = doubleOf();

  await expect(
    byClass.repository.groups(ALL_FILTERS, "errorClass", 5),
  ).resolves.toEqual([
    {
      errorClass: "timeout",
      planId: "p1",
      planName: "Plan",
      stepId: "s1",
      stepLabel: "Step",
      count: 3,
      firstAt: "first",
      lastAt: "last",
      exampleRunIds: ["r1", "r2"],
    },
  ]);
  expect(byClass.query.mock.calls[0]?.[1]).toMatchObject({
    group_limit: 5,
    error_class: "timeout",
    step_id: "s1",
  });
  await byPlan.repository.groups(NO_FILTERS, "plan", 1);
  await byStep.repository.groups(NO_FILTERS, "step", 1);
  expect(byPlan.query.mock.calls[0]?.[0]).toContain(
    "GROUP BY failures.plan_id\n",
  );
  expect(byStep.query.mock.calls[0]?.[0]).toContain("failures.step_id");
});

it("counts the failed steps", async () => {
  const { repository } = doubleOf([[9]]);

  await expect(repository.totalFailedSteps(ALL_FILTERS)).resolves.toBe(9);
  await expect(
    doubleOf().repository.totalFailedSteps(NO_FILTERS),
  ).resolves.toBe(0);
});

it("prunes old failures and orphaned index entries", async () => {
  const { repository, execute } = doubleOf();

  await repository.prune("cut");

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toEqual({ cutoff: "cut" });
});
