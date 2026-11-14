import { vi } from "vitest";

import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";

import {
  STACK_TICKETS,
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
} from "./page175-stack-fixture";

import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type {
  StackEngine,
  StackNodes,
  StackRuntime,
} from "./page175-stack-fixture";

/** Real scheduler with mocked scripts, model, persistence, access and process boundaries. */
export async function failedStackWorld(
  failure: "qa" | "iteration" | "unconfirmed",
): Promise<StackEngine & { readonly runtime: StackRuntime }> {
  const done = stackReport();
  const runtime = stackRuntime({
    work: failure === "iteration" ? [done, done, done] : [done, done],
    qa: [done, done],
  });
  let attempts = 0;
  const execution: PlanExecution = {
    ...runtime.execution,
    open: async (input, signal, observer) => {
      const target = failure === "iteration" ? "work" : "qa";
      const shouldFail =
        input.resourceContext?.stepId === target &&
        ++attempts === (failure === "iteration" ? 2 : 1);
      const session = await runtime.execution.open(input, signal, observer);
      return {
        ...session,
        turn: session.turn.then((turn) =>
          shouldFail
            ? {
                ...turn,
                output: "Needs a fix",
                failure: "failed" as const,
                errorCode: "plan_access_denied" as const,
              }
            : turn,
        ),
        close: async () => {
          const closed = await session.close();
          return shouldFail && failure === "unconfirmed"
            ? { ...closed, isConfirmed: false, leftovers: 1 }
            : closed;
        },
      };
    },
  };
  const world = await stackEngine(execution, {
    nodes: planNodes,
    edges: [
      flow("start", "prepare"),
      flow("prepare", "loop"),
      flow("stack", "work"),
      flow("loop", "qa"),
      flow("qa", "after"),
      flow("after", "end"),
    ],
    script: (script, input) =>
      script.step.id === "prepare"
        ? "saved preparation"
        : `after: ${input.preparation}`,
  });
  return { ...world, runtime };
}

function planNodes(build: StackNodes): readonly AgentPlanNode[] {
  const work = build.agent("work");
  const loop: AgentPlanLoop = {
    id: "loop",
    type: "loop",
    name: "Tickets",
    x: 0,
    y: 0,
    steps: [
      {
        ...work,
        bindings: {
          aufgabe: { kind: "stack", stackId: "stack", output: "content" },
        },
      },
    ],
    edges: [],
    runs: 2,
    runsSource: "value",
    bindings: {},
    countMode: "expected",
    sessionPolicy: "fresh",
    condition: null,
  };
  const after = build.script("after", ["preparation"]);
  return [
    { id: "start", type: "start" as const, x: 0, y: 0 },
    build.script("prepare"),
    {
      id: "stack",
      type: "stack" as const,
      name: "Tickets",
      x: 0,
      y: 0,
      entries: STACK_TICKETS.slice(0, 2).map((ticket, index) => ({
        id: `entry-${index + 1}`,
        type: "task" as const,
        taskId: ticket.id,
      })),
    },
    loop,
    build.plain("qa"),
    {
      ...after,
      bindings: {
        preparation: {
          kind: "result" as const,
          stepId: "prepare",
        },
      },
    },
    { id: "end", type: "end" as const, x: 0, y: 0 },
  ];
}

/** Wires explicit recovery to the same scheduler and durable in-memory records. */
export function recoveryFor(
  world: Pick<StackEngine, "database" | "engine" | "snapshot" | "read">,
  proposed: AgentPlanSnapshot = world.snapshot,
): {
  readonly service: AgentPlanRecoveryService;
  readonly releaseForResume: (runId: string) => Promise<void>;
} {
  world.database.savePlan(proposed);
  const database = world.database.asDatabase();
  const runs = new AgentPlanRunRepository(database);
  const releaseForResume = vi.fn<(runId: string) => Promise<void>>(
    async () => undefined,
  );
  const service = new AgentPlanRecoveryService({
    runs: { run: async (userId, id) => world.read(id) },
    recovery: new AgentPlanRecoveryRepository(database),
    checkpoints: new AgentPlanCheckpointRepository(database),
    execution: {
      access: {
        require: async () => ({
          ...proposed.plan,
          canEdit: true,
          projectName: "Synthetic",
          github: null,
        }),
      },
      preparation: { prepare: async () => proposed },
      engine: world.engine,
      planRuns: {
        latest: async () => null,
        hasReservation: (id) => runs.hasReservation(id),
        release: (id) => runs.release(id),
        engineState: (id) => runs.engineState(id),
      },
      executions: new AgentPlanRecoveryExecutionRepository(database),
      resources: {
        reconcile: vi.fn(async () => 0),
        snapshot: () => ({
          options: {
            maxConcurrentAcpSessions: 4,
            memoryAwareScheduling: false,
            minimumAvailableMemory: 0,
            queueDiscipline: "fifo",
          },
          limitSource: "default",
          availableMemory: null,
          problem: null,
          active: [],
          waiting: [],
        }),
        releaseForResume,
      },
    },
  });
  return { service, releaseForResume };
}
