import { expect, it } from "vitest";

import { readPlanLoopRuns } from "@/backend/agents/AgentPlanLoopRunInput";

import { agentErrorCode } from "./agent-error-code";
import { stepResult } from "./agent-plan-record-fixture";

import type { RecordFields } from "./agent-plan-record-fixture";

function iteration(changes: RecordFields = {}): RecordFields {
  return {
    id: "i1",
    number: 1,
    status: "succeeded",
    startedAt: "start",
    endedAt: "end",
    nodes: [stepResult()],
    condition: { state: "evaluated", isMet: true, found: { type: "object" } },
    error: null,
    ...changes,
  };
}

function session(changes: RecordFields = {}): RecordFields {
  return {
    nodeId: "n",
    key: "key",
    policy: "reuse",
    state: "open",
    createdInIteration: 1,
    turns: 2,
    instanceId: "instance",
    acpSessionId: null,
    nativeSessionId: "native",
    closeout: "pending",
    ...changes,
  };
}

function loop(changes: RecordFields = {}): RecordFields {
  return {
    id: "l1",
    name: "Loop",
    status: "running",
    count: { source: "parameter", parameterId: "p", effective: 3, mode: "max" },
    sessionPolicy: "reuse",
    condition: {
      isActive: true,
      sourceNodeId: "n",
      outputPath: "$.done",
      expected: { type: "boolean", value: true },
    },
    iterations: [iteration()],
    sessions: [session()],
    completion: "condition_met",
    cleanup: "confirmed",
    startedAt: "start",
    endedAt: undefined,
    error: "x".repeat(300),
    ...changes,
  };
}

it("reads a complete loop state and cuts long texts", () => {
  const [result] = readPlanLoopRuns([loop()]);
  expect(result).toMatchObject({
    id: "l1",
    count: { source: "parameter", parameterId: "p", effective: 3, mode: "max" },
    condition: { isActive: true, expected: { type: "boolean", value: true } },
    iterations: [
      {
        number: 1,
        endedAt: "end",
        nodes: [{ id: "s1" }],
        condition: {
          state: "evaluated",
          isMet: true,
          found: { type: "object" },
        },
        error: null,
      },
    ],
    sessions: [{ createdInIteration: 1, turns: 2, closeout: "pending" }],
    completion: "condition_met",
    startedAt: "start",
    endedAt: null,
  });
  expect(result?.error).toHaveLength(200);
});

it("reads a loop state without count, condition and completion", () => {
  const [result] = readPlanLoopRuns([
    loop({
      count: null,
      condition: undefined,
      completion: null,
      iterations: [
        iteration({
          condition: { state: "not_evaluated", reason: "disabled" },
        }),
        iteration({
          condition: { state: "failed", code: "plan_loop_output_missing" },
        }),
        iteration({
          condition: {
            state: "evaluated",
            isMet: false,
            found: { type: "array" },
          },
        }),
        iteration({
          condition: {
            state: "evaluated",
            isMet: false,
            found: { type: "number", value: 1 },
          },
        }),
      ],
      sessions: [
        session({ createdInIteration: null }),
        session({ createdInIteration: undefined }),
      ],
    }),
    loop({ count: undefined, condition: null, completion: undefined }),
  ]);
  expect(result).toMatchObject({
    count: null,
    condition: null,
    completion: null,
  });
  expect(result?.iterations.map((entry) => entry.condition)).toEqual([
    { state: "not_evaluated", reason: "disabled" },
    { state: "failed", code: "plan_loop_output_missing" },
    { state: "evaluated", isMet: false, found: { type: "array" } },
    { state: "evaluated", isMet: false, found: { type: "number", value: 1 } },
  ]);
  expect(result?.sessions.map((entry) => entry.createdInIteration)).toEqual([
    null,
    null,
  ]);
});

it.each<[string, RecordFields]>([
  ["an unknown status", { status: "done" }],
  ["iterations that are no list", { iterations: {} }],
  [
    "more than 999 iterations",
    { iterations: Array.from({ length: 1000 }, () => ({})) },
  ],
  ["sessions that are no list", { sessions: null }],
  [
    "more than 100 sessions",
    { sessions: Array.from({ length: 101 }, () => ({})) },
  ],
  [
    "a count outside the allowed runs",
    { count: { source: "value", effective: 0, mode: "max" } },
  ],
  [
    "an unknown count source",
    { count: { source: "ticket", effective: 1, mode: "max" } },
  ],
  ["a condition without an active flag", { condition: { sourceNodeId: "n" } }],
  ["an unknown completion", { completion: "timeout" }],
  ["an unknown cleanup", { cleanup: "later" }],
  ["a start that is no text", { startedAt: 1 }],
  [
    "an iteration number that is no number",
    { iterations: [iteration({ number: "1" })] },
  ],
  [
    "a fractional iteration number",
    { iterations: [iteration({ number: 1.5 })] },
  ],
  ["an iteration number below one", { iterations: [iteration({ number: 0 })] }],
  [
    "an unknown iteration status",
    { iterations: [iteration({ status: "done" })] },
  ],
  [
    "iteration nodes that are no list",
    { iterations: [iteration({ nodes: null })] },
  ],
  [
    "more than 100 iteration nodes",
    {
      iterations: [
        iteration({ nodes: Array.from({ length: 101 }, () => stepResult()) }),
      ],
    },
  ],
  [
    "an unknown not-evaluated reason",
    {
      iterations: [
        iteration({ condition: { state: "not_evaluated", reason: "x" } }),
      ],
    },
  ],
  [
    "an unknown failure code",
    { iterations: [iteration({ condition: { state: "failed", code: "x" } })] },
  ],
  [
    "an unknown condition state",
    { iterations: [iteration({ condition: { state: "pending" } })] },
  ],
  [
    "an evaluation without a result flag",
    { iterations: [iteration({ condition: { state: "evaluated" } })] },
  ],
  ["turns that are no number", { sessions: [session({ turns: "2" })] }],
  ["fractional turns", { sessions: [session({ turns: 1.5 })] }],
  ["negative turns", { sessions: [session({ turns: -1 })] }],
  [
    "a creating iteration that is no number",
    { sessions: [session({ createdInIteration: "1" })] },
  ],
  [
    "a fractional creating iteration",
    { sessions: [session({ createdInIteration: 1.5 })] },
  ],
  ["an unknown session state", { sessions: [session({ state: "gone" })] }],
])("refuses a loop state with %s", (scenario, change) => {
  expect(agentErrorCode(() => readPlanLoopRuns([loop(change)]))).toBe(
    "plan_invalid",
  );
});

it("refuses loop states that are no list or too many", () => {
  expect(agentErrorCode(() => readPlanLoopRuns({}))).toBe("plan_invalid");
  expect(
    agentErrorCode(() =>
      readPlanLoopRuns(Array.from({ length: 101 }, () => ({}))),
    ),
  ).toBe("plan_invalid");
});
