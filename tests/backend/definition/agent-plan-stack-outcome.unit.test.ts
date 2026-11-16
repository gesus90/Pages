import { expect, it } from "vitest";

import { triggerPlanStack } from "@/definition/AgentPlanStack";
import {
  hasOpenPlanStepReport,
  planStackOutcome,
  planStackParticipants,
} from "@/definition/AgentPlanStackOutcome";

import { partial } from "../app/lib/service-wiring-fakes";
import { agent, groupOf, loopOf, planOf } from "./plan-fixtures";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";

const STACK: AgentPlanStack = {
  id: "stack",
  type: "stack",
  name: "Stack",
  x: 0,
  y: 0,
  entries: [{ id: "entry", type: "task", taskId: "ticket" }],
};
const RECORD = triggerPlanStack(undefined, STACK, {
  loopId: null,
  iteration: null,
  at: "now",
}).record;
const PLAN = planOf(
  [STACK, agent("worker")],
  [{ from: "stack", to: "worker", fromPort: "flow-out", toPort: "flow-in" }],
);

it("finds downstream participants and expands groups without duplicates", () => {
  const reader = agent("reader", {
    item: { kind: "stack", stackId: "stack", output: "content" },
  });
  const group = groupOf("group", [agent("worker"), reader]);
  const plan = planOf(
    [STACK, group, reader],
    [
      { from: "stack", to: "group", fromPort: "flow-out", toPort: "flow-in" },
      { from: "stack", to: "reader", fromPort: "flow-out", toPort: "flow-in" },
    ],
  );
  expect(planStackParticipants(plan, "stack")).toEqual(["worker", "reader"]);
});

it.each([
  ["running", "running", "processing"],
  ["failed", "running", "failed"],
  ["running", "succeeded", "succeeded"],
  ["running", "failed", "failed"],
  ["running", "skipped", "none"],
] as const)(
  "derives %s run and %s worker outcome",
  (runStatus, stepStatus, outcome) => {
    const run = partial<AgentPlanRun>({
      status: runStatus,
      stacks: [RECORD],
      steps: [{ id: "worker", status: stepStatus }],
    });
    expect(planStackOutcome(PLAN, run, "stack")).toBe(outcome);
  },
);

it("requires an accepted report before treating completed processing as successful", () => {
  const step = partial<AgentPlanStepResult>({
    id: "worker",
    status: "succeeded",
    session: { acceptance: { verdict: "open" } },
  });
  expect(hasOpenPlanStepReport(step)).toBe(true);
  expect(
    planStackOutcome(
      PLAN,
      partial<AgentPlanRun>({
        status: "succeeded",
        stacks: [RECORD],
        steps: [step],
      }),
      "stack",
    ),
  ).toBe("open");
  expect(planStackOutcome(PLAN, null, "stack")).toBe("none");
});

it("waits for the matching loop iteration and a regular loop exit", () => {
  const worker = agent("worker", {
    item: { kind: "stack", stackId: "stack", output: "content" },
  });
  const plan = planOf(
    [STACK, loopOf("loop", [worker])],
    [{ from: "stack", to: "worker", fromPort: "flow-out", toPort: "flow-in" }],
  );
  const record = triggerPlanStack(undefined, STACK, {
    loopId: "loop",
    iteration: 1,
    at: "now",
  }).record;
  const iteration = {
    number: 1,
    nodes: [{ id: "worker", status: "succeeded" }],
  };
  const running = partial<AgentPlanRun>({
    status: "running",
    steps: [],
    stacks: [record],
    loops: [
      {
        id: "loop",
        status: "running",
        completion: null,
        cleanup: "pending",
        iterations: [iteration],
      },
    ],
  });
  expect(planStackOutcome(plan, running, "stack")).toBe("processing");
  const completed = partial<AgentPlanRun>({
    ...running,
    status: "succeeded",
    loops: [
      {
        id: "loop",
        status: "succeeded",
        completion: "count",
        cleanup: "confirmed",
        iterations: [iteration],
      },
    ],
  });
  expect(planStackOutcome(plan, completed, "stack")).toBe("succeeded");
  const missing = partial<AgentPlanRun>({
    ...completed,
    loops: [
      {
        id: "loop",
        status: "succeeded",
        completion: "count",
        cleanup: "confirmed",
        iterations: [],
      },
    ],
  });
  expect(planStackOutcome(plan, missing, "stack")).toBe("failed");
});
