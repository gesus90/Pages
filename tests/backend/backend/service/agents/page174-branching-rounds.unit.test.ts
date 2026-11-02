import { expect, it } from "vitest";

import { AgentPlanGroupSessions } from "@/backend/service/agents/AgentPlanGroupSessions";
import { preparePlanContinuation } from "@/backend/service/agents/AgentPlanContinuation";
import { initialPlanRun } from "@/backend/service/agents/AgentPlanRunStart";
import {
  isCompletedPlanRun,
  patchStep,
} from "@/backend/service/agents/AgentPlanRunState";
import { planGroupProgress } from "@/definition/AgentPlanGroupProgress";

import {
  branchEdges,
  branchEngine,
  branchReport,
  branchRuntime,
} from "./page174-branching-fixture";

import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSession,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type {
  AgentPlanRun,
  AgentPlanStepActivation,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

const NEWS = "Fixed the open problem of the round.";

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

const EARLIER: AgentPlanStepActivation = {
  activation: 1,
  status: "succeeded",
  output: "Round one.",
  error: null,
  startedAt: null,
  endedAt: null,
};

it("keeps the count, the earlier starts and the trigger of the nodes of a run that is paused in its second round", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const trigger = {
    kind: "event" as const,
    sources: [{ stepId: "fix", activation: 2 }],
    promptLength: NEWS.length,
  };
  const active: ActivePlanRun = {
    groupCloseout: "open",
    hasPersistenceFailure: false,
    view: initialPlanRun("owner", world.snapshot),
    snapshot: world.snapshot,
    dispatched: new Set(),
    controllers: new Map(),
    executions: new Set(),
  };
  patchStep(active, "start", { status: "succeeded", activation: 1 });
  // The checker waits for its third start with the news of the second fix; the run was paused before it began.
  patchStep(active, "check", {
    status: "waiting",
    activation: 2,
    history: [EARLIER],
    trigger,
  });
  patchStep(active, "decision", {
    status: "waiting",
    activation: 2,
    history: [EARLIER],
  });
  patchStep(active, "fix", {
    status: "paused",
    activation: 2,
    history: [EARLIER],
  });
  const paused: AgentPlanRun = {
    ...active.view,
    status: "paused",
    pauseBoundary: {
      pausedAt: "2026-10-15T00:00:00Z",
      completedStepIds: ["start"],
      pendingStepIds: ["check"],
      frontierStepIds: ["check"],
    },
  };

  const next = preparePlanContinuation(paused, world.snapshot, world.snapshot);

  for (const id of ["check", "decision", "fix"]) {
    const step = stepOf(next.run, id);
    expect(step.status).toBe("waiting");
    expect(step.activation).toBe(2);
    expect(step.history).toEqual([EARLIER]);
  }
  // The news that caused the start is still named, so the checker takes it as a follow-up and not the main instruction.
  expect(stepOf(next.run, "check").trigger).toEqual(trigger);
  expect(stepOf(next.run, "fix").trigger).toBeUndefined();
});

it("starts the checker once after a chain of two fixes, with the news of both and none of them lost", async () => {
  const runtime = branchRuntime({
    check: [branchReport(false), branchReport(true)],
    fixa: [`First: ${NEWS}\n${branchReport(true)}`],
    fixb: [`Second: ${NEWS}\n${branchReport(true)}`],
  });
  const world = await branchEngine(runtime.execution, {
    nodes: (agent) => [
      { id: "start", type: "start", x: 0, y: 0 },
      agent("check", 300),
      { id: "decision", type: "decision", x: 600, y: 0 },
      agent("fixa", 900),
      agent("fixb", 1200),
      { id: "end", type: "end", x: 1500, y: 0 },
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
      { from: "fixa", to: "fixb", fromPort: "flow-out", toPort: "flow-in" },
      { from: "fixa", to: "check", fromPort: "value-out", toPort: "event-in" },
      { from: "fixb", to: "check", fromPort: "value-out", toPort: "event-in" },
    ],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);

  expect(run.status).toBe("succeeded");
  // The checker waited for the second fix of the same round: one start, not one per fix.
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
    "open:fixa",
    "open:fixb",
    "next:check",
  ]);
  const follow = runtime.calls[3]?.prompt ?? "";
  expect(follow).toContain("First:");
  expect(follow).toContain("Second:");
  expect(follow).not.toContain("Main instruction (AGENT.md)");
  expect(stepOf(run, "check").trigger?.sources).toEqual([
    { stepId: "fixa", activation: 1 },
    { stepId: "fixb", activation: 1 },
  ]);
});

it("derives a group behind the branch that was not taken as skipped, not as waiting", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const member = world.snapshot.plan.nodes.find((node) => node.id === "fix");
  if (member?.type !== "agent") throw new Error("The fix node is an agent");
  const group: AgentPlanGroup = {
    id: "group",
    type: "group",
    name: "Group",
    x: 0,
    y: 0,
    steps: [member],
    parameters: [],
    bindings: {},
  };
  const active: ActivePlanRun = {
    groupCloseout: "open",
    hasPersistenceFailure: false,
    view: initialPlanRun("owner", world.snapshot),
    snapshot: world.snapshot,
    dispatched: new Set(),
    controllers: new Map(),
    executions: new Set(),
  };
  patchStep(active, "fix", { status: "skipped", groupId: "group" });

  expect(planGroupProgress(group, active.view)).toMatchObject({
    state: "skipped",
    error: null,
  });
  // A member that ran after all makes the group complete.
  patchStep(active, "fix", { status: "succeeded" });
  expect(planGroupProgress(group, active.view).state).toBe("completed");
});

it("does not hold a finished run back because a loop behind the branch that was not taken never ran", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const done: AgentPlanRun = {
    ...initialPlanRun("owner", world.snapshot),
    steps: world.snapshot.plan.nodes.map((node) => ({
      id: node.id,
      name: node.id,
      status: node.id === "fix" ? "skipped" : "succeeded",
      isBlocked: false,
      cancellation: "none",
      output: null,
      error: null,
    })),
    loops: [
      {
        id: "loop",
        name: "Loop",
        status: "skipped",
        count: null,
        sessionPolicy: "reuse",
        condition: null,
        iterations: [],
        sessions: [],
        completion: null,
        cleanup: "not_needed",
        startedAt: null,
        endedAt: null,
        error: null,
      },
    ],
  };

  expect(isCompletedPlanRun(done)).toBe(true);
  expect(
    isCompletedPlanRun({
      ...done,
      loops: done.loops?.map((loop) => ({ ...loop, status: "waiting" })),
    }),
  ).toBe(false);
});

function turnOf(output: string): PlanSessionTurn {
  return {
    output,
    sessionId: "acp-1",
    failure: null,
    errorCode: null,
    endedAt: "t",
    permissionDenials: 0,
    effective: {},
    events: [],
  };
}

function groupInput(): AgentPlanSessionInput {
  const input: unknown = {
    prompt: "Main instruction",
    userId: "executor",
    directory: "/workspace",
    instanceId: "process",
    mcp: null,
    options: { timeoutMinutes: 10 },
    agent: {
      model: "synthetic",
      reasoningEffort: null,
      connection: { id: "connection", provider: "claude_code" },
    },
    resourceContext: { runId: "run-1", stepId: "check" },
  };
  // Only the fields the session of a group reads are present in this boundary stub.
  return input as AgentPlanSessionInput;
}

function groupRequest(
  key: string,
): Parameters<AgentPlanGroupSessions["turn"]>[0] {
  return {
    key,
    input: groupInput(),
    signal: new AbortController().signal,
    observer: {
      identified: () => undefined,
      started: () => undefined,
    },
  };
}

it("does not offer a session that is closing: the news starts a new session instead of reaching a closing one", async () => {
  let isClosing = false;
  const execution: PlanExecution = {
    run: async () => "",
    open: async (): Promise<PlanSession> => ({
      turn: Promise.resolve(turnOf("first")),
      next: async () => turnOf("next"),
      get isClosing() {
        return isClosing;
      },
      close: async () => ({
        exit: { code: 0, signal: null },
        endedAt: "t",
        leftovers: 0,
        isConfirmed: true,
      }),
    }),
  };
  const groups = new AgentPlanGroupSessions(execution);
  const session = await groups.turn(groupRequest("run-1/check"));
  await session.turn;
  expect(groups.isOpen("run-1/check")).toBe(true);

  // The idle timeout began to close the session; its end is not reported yet.
  isClosing = true;

  expect(groups.isOpen("run-1/check")).toBe(false);
});

it("lets the next start open the session when the first one ended before its process began", async () => {
  let calls = 0;
  const execution: PlanExecution = {
    run: async () => "",
    open: async (): Promise<PlanSession> => {
      calls += 1;
      if (calls === 1)
        throw new Error("The start was cancelled while it waited for capacity");
      return {
        turn: Promise.resolve(turnOf("first")),
        next: async () => turnOf("next"),
        close: async () => ({
          exit: { code: 0, signal: null },
          endedAt: "t",
          leftovers: 0,
          isConfirmed: true,
        }),
      };
    },
  };
  const groups = new AgentPlanGroupSessions(execution);

  await expect(groups.turn(groupRequest("run-1/check"))).rejects.toThrow(
    "cancelled while it waited",
  );
  // No process existed, so nothing was lost and no native resume is needed to open the session.
  const session = await groups.turn(groupRequest("run-1/check"));

  expect((await session.turn).output).toBe("first");
  expect(calls).toBe(2);
});

it("tells a follow-up turn what the adapter announced only after the session opened", async () => {
  const capabilities = { canResume: true, canLoad: true, adapter: "opencode" };
  const execution: PlanExecution = {
    run: async () => "",
    open: async (input, signal, observer): Promise<PlanSession> => {
      signal.throwIfAborted();
      expect(input.prompt).toBe("Main instruction");
      const session: PlanSession = {
        turn: Promise.resolve(turnOf("first")),
        next: async () => turnOf("next"),
        close: async () => ({
          exit: { code: 0, signal: null },
          endedAt: "t",
          leftovers: 0,
          isConfirmed: true,
        }),
      };
      // The adapter answers its handshake after the session was handed over.
      setTimeout(() => observer.capabilities?.(capabilities), 1);
      return session;
    },
  };
  const groups = new AgentPlanGroupSessions(execution);
  await (
    await groups.turn(groupRequest("run-1/check"))
  ).turn;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const announced: unknown[] = [];

  const request = groupRequest("run-1/check");
  const next = await groups.turn({
    ...request,
    observer: {
      ...request.observer,
      capabilities: (value) => announced.push(value),
    },
  });
  await next.turn;

  expect(announced).toEqual([capabilities]);
});
