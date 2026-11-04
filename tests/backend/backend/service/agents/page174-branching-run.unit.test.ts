import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { planResume } from "@/backend/service/agents/recovery/AgentPlanRecoveryPlanning";

import {
  branchEdges,
  branchEngine,
  branchReport,
  branchRuntime,
  reportOnly,
} from "./page174-branching-fixture";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const FIX_ANSWER = (round: number): string =>
  `Fixed the open problem of round ${round}.\n${branchReport(true)}`;

function stepOf(
  run: AgentPlanRun | undefined,
  id: string,
): AgentPlanStepResult {
  const step = run?.steps.find((entry) => entry.id === id);
  if (!step) throw new Error(`No step ${id}`);
  return step;
}

async function finished(
  world: { readonly read: (id: string) => AgentPlanRun },
  id: string,
): Promise<AgentPlanRun> {
  await expect
    .poll(() => world.read(id).status, { timeout: 8000 })
    .toMatch(/^(succeeded|failed|cancelled)$/u);
  return world.read(id);
}

it("takes the true branch at once and never starts the fix branch or an event", async () => {
  const runtime = branchRuntime({ check: [branchReport(true)] });
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(stepOf(run, "decision")).toMatchObject({
    status: "succeeded",
    branch: "true",
    condition: { sourceStepId: "check", sourceActivation: 1, value: true },
  });
  expect(stepOf(run, "fix").status).toBe("skipped");
  expect(stepOf(run, "end").status).toBe("succeeded");
  expect(stepOf(run, "check")).toMatchObject({ passed: true, activation: 1 });
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
  ]);
});

it("evaluates the same decision again after a fix: false, fix, then true in the same session", async () => {
  const runtime = branchRuntime({
    check: [branchReport(false), branchReport(true)],
    fix: [FIX_ANSWER(1)],
  });
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
    "open:fix",
    "next:check",
  ]);
  const [open, , next] = runtime.calls;
  // The first call carries the main instruction; the follow-up carries the news only.
  expect(open?.prompt).toContain("Main instruction (AGENT.md)");
  expect(next?.prompt).toContain("Fixed the open problem of round 1.");
  expect(next?.prompt).toContain('New information from "');
  expect(next?.prompt).not.toContain("Main instruction (AGENT.md)");
  expect(next?.prompt).not.toContain("Instruction check");
  // The closing report of the sender is no information for the receiver.
  expect(next?.prompt).not.toContain("synthetic observable result");
  const decision = stepOf(run, "decision");
  expect(decision).toMatchObject({
    status: "succeeded",
    branch: "true",
    activation: 2,
    condition: { sourceStepId: "check", sourceActivation: 2, value: true },
  });
  expect(decision.history).toMatchObject([
    {
      activation: 1,
      branch: "false",
      condition: { sourceActivation: 1, value: false },
    },
  ]);
  const check = stepOf(run, "check");
  expect(check).toMatchObject({ passed: true, activation: 2 });
  expect(check.trigger).toMatchObject({
    kind: "event",
    sources: [{ stepId: "fix", activation: 1 }],
  });
  expect(check.history).toMatchObject([{ activation: 1, passed: false }]);
  // A start whose session stays open still says when its turn ended.
  expect(check.history?.[0]?.endedAt).not.toBeNull();
  expect(check.session?.event).toMatchObject({
    role: "continued",
    activation: 2,
    turn: 2,
    sourceStepId: "fix",
  });
  expect(stepOf(run, "fix")).toMatchObject({ status: "skipped" });
  expect(stepOf(run, "fix").history).toMatchObject([
    { activation: 1, status: "succeeded" },
  ]);
  expect(stepOf(run, "end").status).toBe("succeeded");
  // The retained session of the checker ends with the run.
  expect(runtime.closed).toContain("check");
  expect(check.session?.closeout).toBe("confirmed");
});

it("evaluates fresh values every pass: false, fix, false, fix, true — one branch each time, no replay", async () => {
  const runtime = branchRuntime({
    check: [branchReport(false), branchReport(false), branchReport(true)],
    fix: [FIX_ANSWER(1), FIX_ANSWER(2)],
  });
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
    "open:fix",
    "next:check",
    "open:fix",
    "next:check",
  ]);
  // The fix agent has no event input: a start by the decision is a regular start with the full instruction.
  expect(runtime.calls[3]?.prompt).toContain("Main instruction (AGENT.md)");
  const decision = stepOf(run, "decision");
  expect(decision.activation).toBe(3);
  expect(
    [...(decision.history ?? []), decision].map((entry) => [
      entry.activation,
      entry.branch,
      entry.condition?.sourceActivation,
    ]),
  ).toEqual([
    [1, "false", 1],
    [2, "false", 2],
    [3, "true", 3],
  ]);
  expect(stepOf(run, "end").activation).toBe(1);
  expect(stepOf(run, "end").history).toBeUndefined();
});

it("refuses a retrigger without usable new information: concrete error at the target, no empty prompt, no false", async () => {
  const runtime = branchRuntime({
    check: [branchReport(false)],
    // The answer is only a report: nothing is left once the report is removed.
    fix: [reportOnly(true)],
  });
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  expect(run.status).toBe("failed");
  const check = stepOf(run, "check");
  expect(check).toMatchObject({
    status: "failed",
    error: "plan_event_prompt_empty",
    trigger: { kind: "event", sources: [{ stepId: "fix", activation: 1 }] },
  });
  expect(check.passed).toBeUndefined();
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
    "open:fix",
  ]);
  expect(stepOf(run, "end").status).not.toBe("succeeded");
  // The earlier result of the checker stays readable in its history.
  expect(check.history).toMatchObject([{ activation: 1, passed: false }]);
});

it("starts a NEW session with the main instruction and the news when the earlier session is no longer open", async () => {
  const runtime = branchRuntime(
    {
      check: [branchReport(false), branchReport(true)],
      fix: [FIX_ANSWER(1)],
    },
    ["fix"],
  );
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  await expect
    .poll(() => runtime.calls.some((call) => call.stepId === "fix"))
    .toBe(true);
  // The adapter process of the checker ends while the fix is still working.
  runtime.retire("check");
  runtime.release("fix");
  const run = await finished(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
    "open:fix",
    "open:check",
  ]);
  const recovered = runtime.calls[2];
  expect(recovered?.prompt).toContain("This is a NEW session");
  expect(recovered?.prompt).toContain("Main instruction (AGENT.md)");
  expect(recovered?.prompt).toContain("Fixed the open problem of round 1.");
  // The record names the new session by its own identity, never the one it replaced.
  expect(stepOf(run, "check").session?.event).toMatchObject({
    role: "recovered",
    activation: 2,
    turn: 1,
    acpSessionId: "native-check",
  });
});

it("stops a cycle that never passes at the activation limit with a concrete error", async () => {
  const rounds = 30;
  const runtime = branchRuntime({
    check: Array.from({ length: rounds }, () => branchReport(false)),
    fix: Array.from({ length: rounds }, (_, index) => FIX_ANSWER(index + 1)),
  });
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  expect(run.status).toBe("failed");
  expect(stepOf(run, "check")).toMatchObject({
    status: "failed",
    error: "plan_activation_limit",
  });
  expect(stepOf(run, "check").history).toHaveLength(25);
  expect(runtime.calls.filter((call) => call.stepId === "check")).toHaveLength(
    25,
  );
});

it("never turns a missing input into false: a checker that failed leaves the decision unevaluated", async () => {
  const runtime = branchRuntime({
    check: ["No report at all.", "No report at all.", "No report at all."],
  });
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  expect(run.status).toBe("failed");
  // A missing report is a form error: it goes back to the agent twice, and never becomes a reported false.
  expect(stepOf(run, "check")).toMatchObject({
    status: "failed",
    error: "plan_acceptance_failed",
    failureStop: { failureClass: "form", attempts: 3, maximumAttempts: 3 },
  });
  expect(stepOf(run, "check").passed).toBeUndefined();
  expect(stepOf(run, "decision").status).not.toBe("succeeded");
  expect(stepOf(run, "decision").branch).toBeUndefined();
  expect(runtime.calls.map((call) => call.stepId)).toEqual([
    "check",
    "check",
    "check",
  ]);
  expect(runtime.calls[1]?.prompt).toContain("report_missing");
});

it("starts the target once when two senders finish together, with both results and no second start", async () => {
  const runtime = branchRuntime({
    check: [branchReport(false), branchReport(true)],
    fixa: [FIX_ANSWER(1)],
    fixb: ["Second finding: the title is missing.\n" + branchReport(true)],
  });
  const world = await branchEngine(runtime.execution, {
    nodes: (agent) => [
      { id: "start", type: "start", x: 0, y: 0 },
      agent("check", 300),
      { id: "decision", type: "decision", x: 600, y: 0 },
      agent("fixa", 900),
      agent("fixb", 900),
      { id: "end", type: "end", x: 1200, y: 0 },
    ],
    edges: [
      ...branchEdges().filter(
        (edge) => edge.from !== "fix" && edge.to !== "fix",
      ),
      {
        from: "decision",
        to: "fixa",
        fromPort: "false-out",
        toPort: "flow-in",
      },
      {
        from: "decision",
        to: "fixb",
        fromPort: "false-out",
        toPort: "flow-in",
      },
      { from: "fixa", to: "check", fromPort: "value-out", toPort: "event-in" },
      { from: "fixb", to: "check", fromPort: "value-out", toPort: "event-in" },
    ],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.filter((call) => call.stepId === "check")).toHaveLength(
    2,
  );
  const follow = runtime.calls.find((call) => call.kind === "next");
  expect(follow?.prompt).toContain("Fixed the open problem of round 1.");
  expect(follow?.prompt).toContain("Second finding: the title is missing.");
  expect(stepOf(run, "check").trigger?.sources).toEqual([
    { stepId: "fixa", activation: 1 },
    { stepId: "fixb", activation: 1 },
  ]);
  expect(stepOf(run, "check").activation).toBe(2);
});

it("ends the retained session of the checker when the run is stopped during the fix", async () => {
  const runtime = branchRuntime(
    {
      check: [branchReport(false), branchReport(true)],
      fix: [FIX_ANSWER(1)],
    },
    ["fix"],
  );
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  await expect
    .poll(() => runtime.calls.some((call) => call.stepId === "fix"))
    .toBe(true);
  await world.engine.stop(started.id);
  runtime.release("fix");
  const run = await finished(world, started.id);
  expect(run.status).toBe("cancelled");
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
    "open:fix",
  ]);
  expect(runtime.closed).toContain("check");
  expect(stepOf(run, "check").session?.closeout).toBe("confirmed");
  expect(stepOf(run, "end").status).not.toBe("succeeded");
});

/** Refuses every preparation of the plan's agents after the first one. */
function refusingAfterFirst(code: AgentErrorCode): () => void {
  let prepares = 0;
  return () => {
    prepares += 1;
    if (prepares > 1) throw new AgentError(code);
  };
}

it("keeps the session and the whole history when a later attempt is refused before its record", async () => {
  const runtime = branchRuntime({ check: ["No report at all."] });
  const world = await branchEngine(runtime.execution, {
    beforePrepare: refusingAfterFirst("plan_access_denied"),
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  const check = stepOf(run, "check");
  expect(check).toMatchObject({
    status: "failed",
    error: "plan_access_denied",
    failureStop: {
      failureClass: "harm",
      attempts: 1,
      maximumAttempts: 1,
      totalAttempts: 2,
    },
  });
  expect(check.session?.sessionId).toBe("native-check");
  expect(check.session?.closeout).toBe("confirmed");
  expect(check.session?.retry).toMatchObject({
    state: "blocked",
    reason: "hard_stop",
    failureClass: "harm",
  });
  expect(
    check.session?.retry?.attempts.map((attempt) => [
      attempt.code,
      attempt.failureClass,
      attempt.attemptId === null,
    ]),
  ).toEqual([
    ["plan_acceptance_failed", "form", false],
    ["plan_access_denied", "harm", true],
  ]);
  expect(runtime.calls.map((call) => call.stepId)).toEqual(["check"]);
  // The first attempt ran, so whatever continues the run has to review its effects.
  expect(
    planResume({
      run,
      checkpoints: [],
      agentStepIds: ["check", "fix"],
      groupIds: [],
    }).retriedStepIds,
  ).toContain("check");
});

it("does not let the report of the earlier attempt turn a refused start into a repair round", async () => {
  const runtime = branchRuntime({ check: ["No report at all."] });
  const world = await branchEngine(runtime.execution, {
    beforePrepare: refusingAfterFirst("plan_model_unavailable"),
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  const check = stepOf(run, "check");
  expect(check.error).toBe("plan_model_unavailable");
  expect(check.session?.retry).toMatchObject({
    state: "blocked",
    reason: "failed",
    failureClass: "open",
  });
  expect(check.session?.retry?.attempts).toHaveLength(2);
  expect(check.failureStop).toMatchObject({
    failureClass: "open",
    attempts: 1,
    totalAttempts: 2,
  });
});
