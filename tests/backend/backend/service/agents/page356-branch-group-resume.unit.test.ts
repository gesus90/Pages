import { expect, it, vi } from "vitest";

import { runDetail } from "@/backend/service/agents/AgentPlanOperationViews";
import { compatibleRecoverySessions } from "@/backend/service/agents/recovery/AgentPlanRecoverySessions";
import { automaticResumeDecision } from "@/backend/service/agents/recovery/AgentPlanAutoResume";
import { planResume } from "@/backend/service/agents/recovery/AgentPlanRecoveryPlanning";

import {
  branchEngine,
  branchReport,
  branchRuntime,
} from "./page174-branching-fixture";
import {
  finishedRun,
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
} from "./page175-stack-fixture";
import { recoveryFor } from "./page356-recovery-fixture";
import { recoveryFixture, patchRecoveryStep } from "./page84-recovery-fixture";
import { resourceWorld } from "./page81-resource-fixture";

import type {
  PlanExecution,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readScopeSince: vi.fn(async () => ({ earliestStart: 0 })),
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
  findTaggedProcesses: vi.fn(async () => []),
}));

function failingTurn(turn: PlanSessionTurn): PlanSessionTurn {
  return {
    ...turn,
    failure: "failed",
    errorCode: "plan_access_denied",
    output: "Fix this attempt",
  };
}

it("continues the failed event activation and its decisions without repeating consumed events", async () => {
  const runtime = branchRuntime({
    check: [branchReport(false), branchReport(true), branchReport(true)],
    fix: [`Saved repair information\n${branchReport(true)}`],
  });
  let checks = 0;
  const execution: PlanExecution = {
    ...runtime.execution,
    open: async (input, signal, observer) => {
      const session = await runtime.execution.open(input, signal, observer);
      const settle = (turn: PlanSessionTurn): PlanSessionTurn =>
        input.resourceContext?.stepId === "check" && ++checks === 2
          ? failingTurn(turn)
          : turn;
      return {
        ...session,
        turn: session.turn.then(settle),
        next: async (next) => {
          if (!session.next) throw new Error("No shared turn");
          return settle(await session.next(next));
        },
      };
    },
  };
  const world = await branchEngine(execution);
  const started = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, started.id);
  expect(failed.status).toBe("failed");
  expect(failed.steps.find((step) => step.id === "check")?.activation).toBe(2);
  const recovery = recoveryFor(world);
  const resumed = await recovery.service.resumeEnded(
    "owner",
    failed.id,
    world.plan.revision,
  );
  const run = await finishedRun(world, resumed.runId ?? "missing");
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.map((call) => call.stepId)).toEqual([
    "check",
    "fix",
    "check",
    "check",
  ]);
  expect(runtime.calls.at(-1)?.prompt).toContain("Saved repair information");
  expect(run.steps.find((step) => step.id === "check")?.activation).toBe(2);
  expect(run.steps.find((step) => step.id === "fix")?.history).toEqual(
    failed.steps.find((step) => step.id === "fix")?.history,
  );
  expect(runDetail(run).continuedFromRunId).toBe(failed.id);
  expect(
    runDetail(run).steps.find((step) => step.stepId === "start")?.isInherited,
  ).toBe(true);
});

it("keeps the completed member of a failed group and starts only its open members", async () => {
  const done = stackReport();
  const runtime = stackRuntime({
    first: [done],
    review: [done, done],
    last: [done],
  });
  let reviews = 0;
  const execution: PlanExecution = {
    ...runtime.execution,
    open: async (input, signal, observer) => {
      const session = await runtime.execution.open(input, signal, observer);
      return {
        ...session,
        next: async (next) => {
          if (!session.next) throw new Error("No shared turn");
          const answer = await session.next(next);
          return next.prompt.includes("Instruction review.") && ++reviews === 1
            ? failingTurn(answer)
            : answer;
        },
      };
    },
  };
  const world = await stackEngine(execution, {
    nodes: ({ plain }) => [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "group",
        type: "group",
        name: "Review",
        x: 0,
        y: 0,
        parameters: [],
        bindings: {},
        edges: [flow("first", "review"), flow("review", "last")],
        steps: [plain("first"), plain("review"), plain("last")],
      },
      { id: "end", type: "end", x: 0, y: 0 },
    ],
    edges: [flow("start", "first"), flow("last", "end")],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, started.id);
  expect(failed.status).toBe("failed");
  const recovery = recoveryFor(world);
  const resumed = await recovery.service.resumeEnded(
    "owner",
    failed.id,
    world.plan.revision,
  );
  const run = await finishedRun(world, resumed.runId ?? "missing");
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.map((call) => call.nodeId)).toEqual([
    "first",
    "review",
    "review",
    "last",
  ]);
  expect(run.steps.find((step) => step.id === "first")).toEqual(
    failed.steps.find((step) => step.id === "first"),
  );
});

it("releases uncertain capacity only for the explicitly resumed run, also after another process removed its durable lease", async () => {
  const world = resourceWorld();
  const own = {
    instanceId: "own",
    userId: "owner",
    provider: "codex_cli" as const,
    runId: "failed",
    stepId: "qa",
    state: "cleanup_failed" as const,
    since: "2026-11-01T00:00:00Z",
  };
  const other = { ...own, instanceId: "other", runId: "another-run" };
  world.records.set(own.instanceId, own);
  world.records.set(other.instanceId, other);
  world.cleanup.mockResolvedValue({ remaining: 1 });
  await world.scheduler.recover();
  world.records.delete("own");
  await world.scheduler.releaseForResume("failed");
  expect(
    world.scheduler.snapshot().active.map((record) => record.instanceId),
  ).toEqual(["other"]);
  expect(world.records.has("other")).toBe(true);
  await world.scheduler.shutdown();
});

it("uses native sessions individually, but drops a session when the saved provider connection changed", async () => {
  const fixture = await recoveryFixture();
  const source = fixture.completed.steps[0]?.session;
  if (!source) throw new Error("Missing synthetic session");
  const run = patchRecoveryStep(fixture.failed, "b", { session: source });
  const planned = planResume({
    run,
    checkpoints: [],
    agentStepIds: ["a", "b", "c"],
    groupIds: [],
  });
  expect(planned.resumeSessions.b).toBe("original-native-session");
  expect(planned.canResumeNatively).toBe(true);
  const proposed = {
    ...fixture.snapshot,
    steps: fixture.snapshot.steps.map((step) =>
      step.step.id === "b"
        ? { ...step, connectionId: "different-connection" }
        : step,
    ),
  };
  expect(
    compatibleRecoverySessions(planned, fixture.snapshot, proposed)
      .resumeSessions,
  ).toEqual({});
});

it("keeps automatic restart conservative when only some interrupted sessions can resume", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.completed.steps[0]?.session;
  if (!session) throw new Error("Missing synthetic session");
  let run = patchRecoveryStep(fixture.failed, "b", {
    status: "running",
    session,
  });
  run = patchRecoveryStep(run, "c", {
    status: "running",
    session: {
      ...session,
      continuationCapabilities: {
        canResume: false,
        canLoad: false,
        adapter: "synthetic-adapter",
      },
      events: ["tool write file"],
    },
  });
  const facts = {
    run,
    plan: {
      ...fixture.snapshot.plan,
      canEdit: true,
      projectName: "Synthetic",
      github: null,
    },
    latest: run,
    isEngineActive: false,
    isReserved: false,
    checkpoints: [],
    executions: [],
    agentStepIds: ["a", "b", "c"],
    groupIds: [],
  };
  expect(planResume(facts).canResumeNatively).toBe(true);
  expect(automaticResumeDecision(facts, 0, 1)).toBe("effect_unknown");
});
