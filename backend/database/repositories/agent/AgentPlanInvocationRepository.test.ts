import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentPlanInvocationRepository } from "./AgentPlanInvocationRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { NewAgentPlanInvocation } from "./AgentPlanInvocationRepository";

type Row = DatabaseValue[];

const PARSED_VALUE: unknown = { type: "text", text: "hi" };
const TEXT_VALUE = JSON.stringify(PARSED_VALUE);

function row(overrides: Readonly<Record<number, DatabaseValue>> = {}): Row {
  const values: Row = [
    "c1",
    "p1",
    "r1",
    "n1",
    1,
    null,
    "key",
    "u1",
    "p2",
    3,
    "entry",
    null,
    null,
    JSON.stringify({ a: PARSED_VALUE }),
    JSON.stringify({ inputs: [], returns: [] }),
    "completion",
    null,
    "shared",
    "none",
    "[]",
    "pending",
    0,
    null,
    "queued",
    null,
    null,
    "t0",
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    values[Number(index)] = value;
  return values;
}

interface Harness {
  readonly query: Mock<Database["query"]>;
  readonly execute: Mock<Database["execute"]>;
  readonly txQuery: Mock<DatabaseTransaction["query"]>;
  readonly txExecute: Mock<DatabaseTransaction["execute"]>;
  readonly repository: AgentPlanInvocationRepository;
}

function setup(): Harness {
  const query = vi.fn<Database["query"]>(async () => []);
  const execute = vi.fn<Database["execute"]>(async () => undefined);
  const txQuery = vi.fn<DatabaseTransaction["query"]>(async () => []);
  const txExecute = vi.fn<DatabaseTransaction["execute"]>(
    async () => undefined,
  );
  const transaction: DatabaseTransaction = {
    query: txQuery,
    execute: txExecute,
  };
  const repository = new AgentPlanInvocationRepository({
    query,
    execute,
    transaction: async (work) => work(transaction),
  });
  return { query, execute, txQuery, txExecute, repository };
}

const NEW_CALL: NewAgentPlanInvocation = {
  id: "c1",
  sourcePlanId: "p1",
  sourceRunId: "r1",
  sourceNodeId: "n1",
  activation: 1,
  iteration: null,
  activationKey: "key",
  userId: "u1",
  targetPlanId: "p2",
  targetRevision: 3,
  entryNodeId: "entry",
  inputs: {},
  contract: { inputs: [], returns: [] },
  wait: "completion",
  signalName: null,
  workspace: "own",
  deadlineAt: null,
};

it("creates a waiting call as queued and reports it as new", async () => {
  const { query, repository } = setup();
  query.mockResolvedValueOnce([["c1"]]).mockResolvedValueOnce([row()]);

  const result = await repository.create(NEW_CALL, "now");

  expect(result.isNew).toBe(true);
  expect(result.record).toMatchObject({
    id: "c1",
    inputs: { a: { type: "text", text: "hi" } },
    workspace: "shared",
  });
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    state: "queued",
    is_detached: 0,
    decided_at: null,
  });
});

it("creates a continuing call as accepted and detached", async () => {
  const { query, repository } = setup();
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([row()]);

  const result = await repository.create(
    { ...NEW_CALL, wait: "continue" },
    "now",
  );

  expect(result.isNew).toBe(false);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    state: "accepted",
    is_detached: 1,
    decided_at: "now",
  });
});

it("refuses a created call that cannot be read back", async () => {
  await expect(
    setup().repository.create(NEW_CALL, "now"),
  ).rejects.toMatchObject({
    code: "plan_jump_invocation_missing",
  });
});

it("reads calls by identity, source and target run", async () => {
  const { query, repository } = setup();
  query.mockResolvedValue([
    row({ 5: 2, 11: "t1", 21: 1, 25: JSON.stringify({}) }),
  ]);

  expect(await repository.find("c1")).toMatchObject({
    iteration: 2,
    targetRunId: "t1",
    isDetached: true,
    outcome: { values: {} },
  });
  expect(await repository.findBySource("r1", "n1", "key")).not.toBeNull();
  expect(await repository.findByTargetRun("t1")).not.toBeNull();
});

it("reads an own workspace mode", async () => {
  const { query, repository } = setup();
  query.mockResolvedValue([row({ 17: "own" })]);

  expect((await repository.find("c1"))?.workspace).toBe("own");
});

it("reads no call that is missing", async () => {
  expect(await setup().repository.find("c1")).toBeNull();
});

it("reads the interface of a call without one as empty", async () => {
  const { query, repository } = setup();
  query.mockResolvedValue([
    row({
      14: "{}",
      25: JSON.stringify({ values: { a: PARSED_VALUE } }),
    }),
  ]);

  const record = await repository.find("c1");

  expect(record?.contract).toEqual({ inputs: [], returns: [] });
  expect(record?.outcome?.values).toEqual({ a: { type: "text", text: "hi" } });
});

it("lists calls of several kinds", async () => {
  const { query, repository } = setup();
  query.mockResolvedValue([row(), row()]);

  expect(await repository.forSourceRun("r1")).toHaveLength(2);
  expect(await repository.pendingStarts()).toHaveLength(2);
  expect(await repository.undecided()).toHaveLength(2);
  expect(await repository.openTargets()).toHaveLength(2);
});

it("refuses stored values outside the allowed vocabularies", async () => {
  const { query, repository } = setup();
  const cases: [number, DatabaseValue, string][] = [
    [23, "bogus", "invalid call state"],
    [20, "bogus", "invalid call start state"],
    [18, "bogus", "invalid handover state"],
    [15, "bogus", "invalid call wait"],
  ];

  for (const [index, value, message] of cases) {
    query.mockResolvedValueOnce([row({ [index]: value })]);
    await expect(repository.find("c1")).rejects.toThrow(message);
  }
});

it("accepts every valid start and handover state", async () => {
  const { query, repository } = setup();
  for (const [start, handover, wait] of [
    ["started", "handed_over", "continue"],
    ["cancelled", "returned", "signal"],
  ] as const) {
    query.mockResolvedValueOnce([row({ 20: start, 18: handover, 15: wait })]);
    expect(await repository.find("c1")).toMatchObject({
      start,
      handover,
      wait,
    });
  }
});

it("starts a pending call and refuses a call that cannot start", async () => {
  const { txQuery, repository } = setup();
  const transaction: DatabaseTransaction = {
    query: txQuery,
    execute: vi.fn(),
  };
  txQuery.mockResolvedValueOnce([["c1"]]).mockResolvedValueOnce([]);

  await repository.begin(transaction, "c1", "t1", "now");
  await expect(
    repository.begin(transaction, "c1", "t1", "now"),
  ).rejects.toMatchObject({ code: "plan_jump_start_conflict" });
});

it("decides a call once", async () => {
  const { query, repository } = setup();
  query.mockResolvedValueOnce([["c1"]]).mockResolvedValueOnce([]);
  const outcome = { values: {} };

  expect(
    await repository.decide(
      "c1",
      { state: "succeeded", reason: null, outcome },
      "now",
    ),
  ).toBe(true);
  expect(
    await repository.decide(
      "c1",
      { state: "failed", reason: "x", outcome: null },
      "now",
    ),
  ).toBe(false);
  expect(query.mock.calls[0]?.[1]).toMatchObject({ outcome: '{"values":{}}' });
  expect(query.mock.calls[1]?.[1]).toMatchObject({ outcome: null });
});

it("decides a timeout only when the statement matched", async () => {
  const { query, repository } = setup();
  query.mockResolvedValueOnce([["c1"]]).mockResolvedValueOnce([]);

  expect(await repository.decideTimeout("c1", "now")).toBe(true);
  expect(await repository.decideTimeout("c1", "now")).toBe(false);
});

it("accepts a signal that is the awaited one", async () => {
  const { txQuery, txExecute, repository } = setup();
  txQuery.mockResolvedValueOnce([["go"]]).mockResolvedValueOnce([["go"]]);
  const payload = { type: "text", text: "hi" } as const;

  expect(
    await repository.acceptSignal("c1", "t1", { name: "go", payload }, "now"),
  ).toBe(true);

  expect(txQuery.mock.calls[1]?.[1]).toMatchObject({
    payload: JSON.stringify(payload),
  });
  expect(txExecute).toHaveBeenCalledOnce();
});

it("stores a signal without payload that is not the awaited one", async () => {
  const { txQuery, txExecute, repository } = setup();
  txQuery.mockResolvedValueOnce([["other"]]).mockResolvedValueOnce([["go"]]);

  expect(
    await repository.acceptSignal(
      "c1",
      "t1",
      { name: "go", payload: null },
      "now",
    ),
  ).toBe(true);

  expect(txQuery.mock.calls[1]?.[1]).toMatchObject({ payload: null });
  expect(txExecute).not.toHaveBeenCalled();
});

it("accepts no signal for a decided call or a repeated name", async () => {
  const { txQuery, repository } = setup();
  const signal = { name: "go", payload: null };
  txQuery.mockResolvedValueOnce([]);

  expect(await repository.acceptSignal("c1", "t1", signal, "now")).toBe(false);

  txQuery.mockResolvedValueOnce([["go"]]).mockResolvedValueOnce([]);

  expect(await repository.acceptSignal("c1", "t1", signal, "now")).toBe(false);
});

it("reads an accepted signal with and without payload", async () => {
  const { query, repository } = setup();
  query
    .mockResolvedValueOnce([["go", TEXT_VALUE, "t"]])
    .mockResolvedValueOnce([["go", null, "t"]])
    .mockResolvedValueOnce([]);

  expect(await repository.signal("c1", "go")).toEqual({
    name: "go",
    payload: { type: "text", text: "hi" },
    acceptedAt: "t",
  });
  expect((await repository.signal("c1", "go"))?.payload).toBeNull();
  expect(await repository.signal("c1", "go")).toBeNull();
});

it("writes the bookkeeping updates of a call", async () => {
  const { execute, repository } = setup();

  await repository.cancelStart("c1", "now");
  await repository.recordTargetStatus("t1", "running", "now");
  await repository.failStart("c1", "why", "now");
  await repository.recordCleanupOpen("c1", "now");
  await repository.detach("c1", "now");

  expect(execute).toHaveBeenCalledTimes(5);
  expect(execute.mock.calls[2]?.[1]).toEqual({
    id: "c1",
    reason: "why",
    now: "now",
  });
});

it("lists the runs a run waits for", async () => {
  const { query, repository } = setup();
  query.mockResolvedValue([["t1"], ["t2"]]);

  expect(await repository.waitingTargets("r1")).toEqual(["t1", "t2"]);
});

it("tells whether a plan has an active run or a run holds a reservation", async () => {
  const { query, repository } = setup();
  query
    .mockResolvedValueOnce([[1]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[1]])
    .mockResolvedValueOnce([]);

  expect(await repository.hasActiveRun("p1")).toBe(true);
  expect(await repository.hasActiveRun("p1")).toBe(false);
  expect(await repository.hasReservation("r1")).toBe(true);
  expect(await repository.hasReservation("r1")).toBe(false);
});
