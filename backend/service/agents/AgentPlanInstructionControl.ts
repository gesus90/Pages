import { randomUUID } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { ActivePlanRun } from "./AgentPlanRunState";

/** A console turn participates in the same dispatch gate and drain as graph steps. */
export interface PlanInstructionControl {
  readonly signal: AbortSignal;
  readonly claimStart: () => void;
}

export type PlanInstructionWork = (
  control: PlanInstructionControl,
) => Promise<PlanSessionTurn>;

interface InstructionPersistence {
  readonly writes: SerialQueue;
  readonly runs: Pick<AgentPlanRunRepository, "update">;
  readonly settled: () => Promise<void>;
}

/** Registers additional console work before it enters a retained group's queue. */
export async function runPlanInstruction(
  active: ActivePlanRun,
  persistence: InstructionPersistence,
  work: PlanInstructionWork,
): Promise<PlanSessionTurn> {
  const { writes } = persistence;
  const id = `instruction/${randomUUID()}`;
  const controller = new AbortController();
  await writes.run(async () => {
    if (active.view.status !== "running" || active.view.stopRequested)
      throw new AgentError("plan_run_unavailable");
    active.controllers.set(id, controller);
  });
  try {
    const turn = await work({
      signal: controller.signal,
      claimStart: () => {
        if (active.dispatched.has(id)) return;
        if (active.view.status !== "running") throw new AgentPlanPausedError();
        active.dispatched.add(id);
      },
    });
    if (turn.failure !== null || turn.errorCode !== null)
      await persistFailure(active, persistence);
    return turn;
  } catch (error: unknown) {
    if (active.dispatched.has(id) && !active.view.stopRequested)
      await persistFailure(active, persistence);
    throw error;
  } finally {
    await writes.run(async () => {
      active.controllers.delete(id);
      active.dispatched.delete(id);
    });
    await persistence.settled();
  }
}

async function persistFailure(
  active: ActivePlanRun,
  persistence: InstructionPersistence,
): Promise<void> {
  await persistence.writes.run(async () => {
    recordFailure(active);
    try {
      await persistence.runs.update(active.view);
    } catch (error: unknown) {
      active.hasPersistenceFailure = true;
      throw error;
    }
  });
}

function recordFailure(active: ActivePlanRun): void {
  if (active.view.stopRequested) return;
  active.view = {
    ...active.view,
    status: "pausing",
    controlError: "plan_step_failed",
    steps: active.view.steps.map((step) =>
      step.status === "waiting" ? { ...step, status: "paused" } : step,
    ),
  };
}
