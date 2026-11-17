import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import { patchStep } from "./AgentPlanRunState";
import {
  readRunBranchBaseline,
  withRunBranch,
} from "./AgentPlanRunBranchCapture";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type {
  AgentPlanScriptRunner,
  ScriptRunControl,
} from "./AgentPlanScriptRunner";

/** Uses the engine's durable dispatch gate and writes; no separate scheduling or process history. */
export async function dispatchPlanScript(
  active: ActivePlanRun,
  stepId: string,
  controller: AbortController,
  dependencies: {
    readonly scripts: Pick<AgentPlanScriptRunner, "run"> | undefined;
    readonly writes: SerialQueue;
    readonly runs: Pick<AgentPlanRunRepository, "update">;
  },
): Promise<Partial<AgentPlanStepResult>> {
  active.dispatched.delete(stepId);
  const script = active.snapshot.scripts?.find(
    (entry) => entry.step.id === stepId,
  );
  if (!script || !dependencies.scripts)
    return { status: "failed", error: "plan_script_interpreter_unavailable" };
  const baseline = await readRunBranchBaseline(active.snapshot, script);
  const result = await dependencies.scripts.run(
    active.view,
    active.snapshot,
    script,
    scriptControl(active, stepId, controller, dependencies),
  );
  return withRunBranch(result, {
    baseline,
    script,
    recordedAt: new Date().toISOString(),
  });
}

function scriptControl(
  active: ActivePlanRun,
  stepId: string,
  controller: AbortController,
  dependencies: {
    readonly writes: SerialQueue;
    readonly runs: Pick<AgentPlanRunRepository, "update">;
  },
): ScriptRunControl {
  return {
    signal: controller.signal,
    claimStart: () => {
      controller.signal.throwIfAborted();
      if (active.view.status !== "running") throw new AgentPlanPausedError();
      active.dispatched.add(stepId);
    },
    save: async (record) => {
      await dependencies.writes.run(async () => {
        if (active.view.stopRequested) return;
        patchStep(active, stepId, { script: record });
        try {
          await dependencies.runs.update(active.view);
        } catch (error: unknown) {
          active.hasPersistenceFailure = true;
          for (const running of active.controllers.values()) running.abort();
          throw error;
        }
      });
    },
  };
}
