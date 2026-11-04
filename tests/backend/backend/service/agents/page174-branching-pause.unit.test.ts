import { expect, it, vi } from "vitest";

// The waits of a technical session error before its retries are not what these tests check.
vi.mock("@/definition/AgentPlanRetry", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, PLAN_INFRASTRUCTURE_RETRY_DELAYS: [5, 5, 5] };
});

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { initialPlanRun } from "@/backend/service/agents/AgentPlanRunStart";
import { patchStep } from "@/backend/service/agents/AgentPlanRunState";
import {
  eventStart,
  startedStep,
  unstartedChanges,
} from "@/backend/service/agents/branching/AgentPlanBranchSettle";
import { newPlanBranchingState } from "@/backend/service/agents/branching/AgentPlanBranchState";

import {
  branchEngine,
  branchReport,
  branchRuntime,
} from "./page174-branching-fixture";

import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const NEWS = "Fixed the open problem of round 1.";
const CLOSED = {
  exit: { code: 0, signal: null },
  endedAt: "2026-10-15T00:00:00Z",
  leftovers: 0,
  isConfirmed: true,
};

function turn(
  output: string,
  stepId: string,
  failure: "failed" | null = null,
): PlanSessionTurn {
  return {
    output,
    sessionId: failure ? null : `native-${stepId}`,
    failure,
    errorCode: failure ? "plan_acp_session_failed" : null,
    endedAt: "2026-10-15T00:00:00Z",
    permissionDenials: 0,
    effective: { model: "synthetic-free:free" },
    events: [],
  };
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

async function activeRun(): Promise<ActivePlanRun> {
  const world = await branchEngine(branchRuntime({}).execution);
  const active: ActivePlanRun = {
    groupCloseout: "open",
    hasPersistenceFailure: false,
    view: initialPlanRun("owner", world.snapshot),
    snapshot: world.snapshot,
    dispatched: new Set(),
    controllers: new Map(),
    executions: new Set(),
  };
  return active;
}

it("keeps the news of the checker that a pause stopped before its start, and counts that start once", async () => {
  const scripts: Record<string, string[]> = {
    check: [branchReport(false), branchReport(true)],
    fix: [`${NEWS}\n${branchReport(true)}`],
  };
  const opens: { stepId: string; prompt: string }[] = [];
  const observers = new Map<string, PlanSessionObserver>();
  let releaseFix: () => void = () => undefined;
  const fixGate = new Promise<void>((resolve) => {
    releaseFix = resolve;
  });
  let releaseCapacity: () => void = () => undefined;
  const capacityGate = new Promise<void>((resolve) => {
    releaseCapacity = resolve;
  });
  let checkOpens = 0;
  const answer = (stepId: string): PlanSessionTurn => {
    const output = scripts[stepId]?.shift();
    if (output === undefined) throw new Error(`No answer for ${stepId}`);
    return turn(output, stepId);
  };
  const execution: PlanExecution = {
    run: async () => {
      throw new Error("No API requests");
    },
    open: vi.fn<PlanExecution["open"]>(async (input, signal, observer) => {
      const stepId = input.resourceContext?.stepId ?? "";
      opens.push({ stepId, prompt: input.prompt });
      observers.set(stepId, observer);
      checkOpens += stepId === "check" ? 1 : 0;
      if (stepId === "check" && checkOpens === 2)
        // The second start waits for capacity; the abort of a pause ends the wait.
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("Aborted while waiting for capacity")),
            { once: true },
          );
          void capacityGate.then(resolve);
        });
      signal.throwIfAborted();
      observer.identified(`native-${stepId}`);
      const session: PlanSession = {
        turn: (stepId === "fix" ? fixGate : Promise.resolve()).then(() =>
          answer(stepId),
        ),
        next: async () => answer(stepId),
        close: async () => CLOSED,
      };
      return session;
    }),
  };
  const world = await branchEngine(execution);
  const started = await world.engine.start("owner", world.snapshot);
  await expect
    .poll(() => opens.some((open) => open.stepId === "fix"))
    .toBe(true);
  // The adapter of the checker ends while the fix works: the news starts a recovered session.
  observers.get("check")?.retired?.(CLOSED, "process_exit");
  releaseFix();
  await expect.poll(() => checkOpens).toBe(2);
  await world.engine.pause(started.id);
  await expect.poll(() => world.read(started.id).status).toBe("paused");
  const paused = world.read(started.id).steps.find((s) => s.id === "check");
  // The start that never began is no start: its count is given back, the news stays.
  expect(paused?.activation).toBe(1);
  expect(paused?.trigger?.kind).toBe("event");
  await world.engine.resume(started.id, world.snapshot);
  releaseCapacity();
  const run = await finished(world, started.id);
  const checks = opens.filter((open) => open.stepId === "check");
  // The start after the resume carries the news, and the main instruction as a recovered start does.
  expect(checks.at(-1)?.prompt).toContain(NEWS);
  expect(checks.at(-1)?.prompt).toContain("Main instruction (AGENT.md)");
  expect(run.status).toBe("succeeded");
  expect(run.steps.find((s) => s.id === "check")?.activation).toBe(2);
});

it("retries a technical session error of the first start of an agent with an event input like a plain agent", async () => {
  let checkOpens = 0;
  const opened: string[] = [];
  const execution: PlanExecution = {
    run: async () => {
      throw new Error("No API requests");
    },
    open: vi.fn<PlanExecution["open"]>(async (input, signal, observer) => {
      const stepId = input.resourceContext?.stepId ?? "";
      opened.push(stepId);
      signal.throwIfAborted();
      observer.identified(`native-${stepId}`);
      checkOpens += stepId === "check" ? 1 : 0;
      const isFailing = stepId === "check" && checkOpens === 1;
      return {
        turn: Promise.resolve(
          isFailing
            ? turn("", stepId, "failed")
            : turn(branchReport(true), stepId),
        ),
        next: async () => turn(branchReport(true), stepId),
        close: async () => CLOSED,
      };
    }),
  };
  const world = await branchEngine(execution);
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  const check = run.steps.find((s) => s.id === "check");
  // The first session failed, and a clean one took its place; nothing was blocked as unsafe.
  expect(opened.filter((id) => id === "check")).toHaveLength(2);
  expect(check?.status).toBe("succeeded");
  expect(check?.session?.retry?.state).toBe("completed");
  expect(run.status).toBe("succeeded");
});

it("gives back the count of a start that a pause ended before it began, and no other", async () => {
  const active = await activeRun();
  patchStep(active, "check", startedStep(active, "check"));
  patchStep(active, "check", startedStep(active, "check"));
  expect(active.view.steps.find((s) => s.id === "check")?.activation).toBe(2);
  expect(unstartedChanges(active, "check", { status: "paused" })).toEqual({
    status: "paused",
    activation: 1,
  });
  expect(unstartedChanges(active, "check", { status: "failed" })).toEqual({
    status: "failed",
  });
  // The first start has no count left to keep.
  expect(
    unstartedChanges(active, "fix", { status: "paused" }).activation,
  ).toBeUndefined();
});

it("fails a node whose start an event caused when its news is gone, instead of replaying the main instruction", async () => {
  const active = await activeRun();
  active.branching = newPlanBranchingState();
  // No event started the node: an ordinary start has no event, and no error.
  expect(eventStart(active, "check")).toEqual({});
  patchStep(active, "check", {
    activation: 2,
    trigger: {
      kind: "event",
      sources: [{ stepId: "fix", activation: 1 }],
      promptLength: NEWS.length,
    },
  });
  expect(() => eventStart(active, "check")).toThrow(
    expect.objectContaining({ code: "plan_event_prompt_empty" }),
  );
  active.branching.prompts.set("check", NEWS);
  expect(eventStart(active, "check")).toEqual({
    event: { prompt: NEWS, activation: 2, sourceStepIds: ["fix"] },
  });
});

it("continues after a technical refusal of a later attempt, on the record that exists, and counts it", async () => {
  const runtime = branchRuntime({
    check: ["No report at all.", branchReport(true)],
    fix: [],
  });
  let prepares = 0;
  const world = await branchEngine(runtime.execution, {
    beforePrepare: () => {
      prepares += 1;
      if (prepares === 2) throw new AgentError("plan_runner_admission_failed");
    },
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);
  expect(run.steps.find((s) => s.id === "check")).toMatchObject({
    status: "succeeded",
    session: {
      retry: {
        state: "completed",
        attempts: [
          { failureClass: "form" },
          { failureClass: "infrastructure", attemptId: null },
        ],
      },
    },
  });
});

it("keeps record and retry state when a pause ends a later attempt before its record, and goes on after the resume", async () => {
  const runtime = branchRuntime({
    check: ["No report at all.", branchReport(true)],
    fix: [],
  });
  let prepares = 0;
  let runId: string | null = null;
  const world = await branchEngine(runtime.execution, {
    beforePrepare: async () => {
      prepares += 1;
      if (prepares !== 2) return;
      await vi.waitFor(() => expect(runId).not.toBeNull());
      await world.engine.pause(runId ?? "");
      throw new AgentPlanPausedError();
    },
  });
  const started = await world.engine.start("owner", world.snapshot);
  runId = started.id;
  await expect
    .poll(() => world.read(started.id).status, { timeout: 8000 })
    .toBe("paused");
  expect(
    world.read(started.id).steps.find((s) => s.id === "check"),
  ).toMatchObject({
    session: {
      sessionId: "native-check",
      retry: { state: "waiting", attempts: [{ failureClass: "form" }] },
    },
  });
  await world.engine.resume(started.id);
  const run = await finished(world, started.id);
  expect(run.steps.find((s) => s.id === "check")).toMatchObject({
    status: "succeeded",
    session: {
      retry: { state: "completed", attempts: [{ failureClass: "form" }] },
    },
  });
  expect(runtime.calls.filter((call) => call.stepId === "check")).toHaveLength(
    2,
  );
});
