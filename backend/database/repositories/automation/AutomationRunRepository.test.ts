import { expect, it, vi } from "vitest";

import { AutomationRunRepository } from "./AutomationRunRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(...results: unknown[][][]): {
  repository: AutomationRunRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn<() => Promise<unknown[][]>>();
  for (const rows of results) query.mockResolvedValueOnce(rows);
  query.mockResolvedValue([]);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AutomationRunRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

function rowOf(overrides: Record<number, unknown> = {}): unknown[] {
  const row: unknown[] = [
    "r1",
    5n,
    "a1",
    "event",
    "plan.failed",
    "subject",
    "{}",
    "u1",
    "completed",
    "ok",
    7,
    "woken",
    "pr1",
    "done",
    1,
    "E",
    "sum",
    "ans",
    "out",
    "err",
    "q",
    "s",
    "e",
  ];
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  return row;
}

const REQUEST = {
  id: "r1",
  automationId: "a1",
  triggerKind: "event",
  eventType: "plan.failed",
  triggerSubject: "subject",
  triggerData: "{}",
  requestedBy: "u1",
  queuedAt: "q",
} as const;

it("maps a full run row", async () => {
  const { repository, query } = doubleOf([rowOf()], [rowOf()]);

  const expected = {
    id: "r1",
    sequence: 5,
    automationId: "a1",
    triggerKind: "event",
    eventType: "plan.failed",
    triggerSubject: "subject",
    triggerData: "{}",
    requestedBy: "u1",
    status: "completed",
    outcome: "ok",
    exitCode: 7,
    forwardState: "woken",
    planRunId: "pr1",
    planRunStatus: "done",
    paused: true,
    errorCode: "E",
    summary: "sum",
    answer: "ans",
    output: "out",
    error: "err",
    queuedAt: "q",
    startedAt: "s",
    endedAt: "e",
  };
  expect(await repository.find("a1", "r1")).toEqual(expected);
  expect(await repository.findById("r1")).toEqual(expected);
  expect(query.mock.calls[0]?.[1]).toEqual({ id: "r1", automation_id: "a1" });
});

it("falls back for unknown values and missing numbers", async () => {
  const { repository } = doubleOf([
    rowOf({
      1: "x",
      3: "weird",
      4: null,
      8: "weird",
      9: null,
      10: 2n,
      11: "weird",
      14: 0,
    }),
  ]);

  const run = await repository.findById("r1");

  expect(run).toMatchObject({
    sequence: 0,
    triggerKind: "manual",
    eventType: null,
    status: "failed",
    outcome: null,
    exitCode: 2,
    forwardState: null,
    paused: false,
  });
});

it("reads not_woken and a missing run", async () => {
  const { repository } = doubleOf([rowOf({ 11: "not_woken" })], []);

  expect((await repository.find("a1", "r1"))?.forwardState).toBe("not_woken");
  expect(await repository.find("a1", "r2")).toBeNull();
  expect(await repository.findById("r2")).toBeNull();
});

it("enqueues a new run", async () => {
  const { repository, query } = doubleOf([rowOf()]);

  const result = await repository.enqueue(REQUEST);

  expect(result.isCoalesced).toBe(false);
  expect(result.run.id).toBe("r1");
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    automation_id: "a1",
    trigger_kind: "event",
  });
});

it("joins the waiting run when one exists", async () => {
  const { repository, query } = doubleOf([], [rowOf({ 0: "waiting" })]);

  const result = await repository.enqueue(REQUEST);

  expect(result.isCoalesced).toBe(true);
  expect(result.run.id).toBe("waiting");
  expect(query.mock.calls[1]?.[1]).toEqual({ automation_id: "a1" });
});

it("fails when the waiting run vanished", async () => {
  const { repository } = doubleOf([], []);

  await expect(repository.enqueue(REQUEST)).rejects.toThrow(
    "The waiting run vanished.",
  );
});

it("lists startable and open runs", async () => {
  const { repository, query } = doubleOf([rowOf()], [rowOf()]);

  expect(await repository.startable(3)).toHaveLength(1);
  expect(await repository.open()).toHaveLength(1);
  expect(query.mock.calls[0]?.[1]).toEqual({ limit: 3 });
});

it("claims a waiting run only once", async () => {
  const { repository } = doubleOf([["r1"]], []);

  expect(await repository.claim("r1", "s")).toBe(true);
  expect(await repository.claim("r1", "s")).toBe(false);
});

it("delivers a run with its plan run", async () => {
  const { repository, execute } = doubleOf();

  await repository.deliver("r1", "pr1");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "r1",
    started_plan_run_id: "pr1",
  });
});

it("finishes a run with every field", async () => {
  const { repository, query } = doubleOf([["r1"]], []);

  const ended = await repository.finish("r1", {
    status: "failed",
    outcome: "failed",
    exitCode: 1,
    forwardState: "woken",
    planRunStatus: "x",
    paused: true,
    errorCode: "E",
    summary: "s",
    answer: "a",
    output: "o",
    error: "e",
    endedAt: "t",
  });
  const again = await repository.finish("r1", {
    status: "completed",
    outcome: "ok",
    endedAt: "t",
  });

  expect(ended).toBe(true);
  expect(again).toBe(false);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    exit_code: 1,
    forward_state: "woken",
    plan_run_status: "x",
    paused: true,
    error_code: "E",
  });
  expect(query.mock.calls[1]?.[1]).toMatchObject({
    exit_code: null,
    forward_state: null,
    plan_run_status: null,
    paused: false,
    error_code: null,
    summary: null,
    answer: null,
    output: null,
    error: null,
  });
});

it("marks a run as paused", async () => {
  const { repository, execute } = doubleOf();

  await repository.markPaused("r1");

  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "r1" });
});

it("lists runs with and without a cursor", async () => {
  const { repository, query } = doubleOf([rowOf()], []);

  const first = await repository.list({
    automationIds: ["a1", "a2"],
    beforeSequence: 9,
    limit: 2,
  });
  await repository.list({
    automationIds: ["a1"],
    beforeSequence: null,
    limit: 2,
  });

  expect(first).toHaveLength(1);
  expect(query.mock.calls[0]?.[1]).toEqual({
    automation_ids: "a1,a2",
    before_sequence: 9,
    limit: 2,
  });
  expect(query.mock.calls[1]?.[1]).toMatchObject({ before_sequence: 0 });
});

it("lists no runs without automations", async () => {
  const { repository, query } = doubleOf();

  expect(
    await repository.list({
      automationIds: [],
      beforeSequence: null,
      limit: 1,
    }),
  ).toEqual([]);
  expect((await repository.latest([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("maps the newest run of each automation", async () => {
  const { repository, query } = doubleOf([
    rowOf(),
    rowOf({ 0: "r2", 2: "a2" }),
  ]);

  const latest = await repository.latest(["a1", "a2"]);

  expect(latest.get("a2")?.id).toBe("r2");
  expect(latest.size).toBe(2);
  expect(query.mock.calls[0]?.[1]).toEqual({ automation_ids: "a1,a2" });
});

it("counts runs and treats a missing count as zero", async () => {
  const { repository } = doubleOf([[4n]], [], [["x"]], [[3]], []);

  expect(await repository.count("a1")).toBe(4);
  expect(await repository.count("a1")).toBe(0);
  expect(await repository.count("a1")).toBe(0);
  expect(await repository.countEventRunsSince("a1", "t")).toBe(3);
  expect(await repository.countEventRunsSince("a1", "t")).toBe(0);
});

it("finds the blocking run", async () => {
  const { repository } = doubleOf([rowOf()], []);

  expect((await repository.blocking("a1"))?.id).toBe("r1");
  expect(await repository.blocking("a1")).toBeNull();
});

it("prunes runs beyond the kept number", async () => {
  const { repository, execute } = doubleOf();

  await repository.prune("a1", 50);

  expect(execute.mock.calls[0]?.[1]).toEqual({
    automation_id: "a1",
    keep: 50,
  });
});

it("tells whether a run started a plan run", async () => {
  const { repository } = doubleOf([[1]], []);

  expect(await repository.startedPlanRun("a1", "pr1")).toBe(true);
  expect(await repository.startedPlanRun("a1", "pr2")).toBe(false);
});
