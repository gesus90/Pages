import { logCaughtError } from "@/backend/logging/Logger";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { settleUnstartedScript } from "./AgentPlanScriptOwner";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

async function settledStep(
  step: AgentPlanStepResult,
): Promise<AgentPlanStepResult> {
  if (!step.script || step.remote || step.execution?.target.kind === "remote")
    return step;
  try {
    const script = await settleUnstartedScript(step.script);
    return script === step.script ? step : { ...step, script };
  } catch (error: unknown) {
    logCaughtError("AgentPlanStoppedScripts", error);
    return step;
  }
}

/**
 * Confirms the closeout of local scripts of a stopped run that never got a process.
 * @remarks
 * The engine no longer stores script records after Stop, so an attempt that
 * was dispatched but never spawned would keep `closeout: "pending"` and with
 * it the workspace reservation. Returns the same run when nothing changed.
 */
export async function settleStoppedScripts(
  run: AgentPlanRun,
): Promise<AgentPlanRun> {
  const steps = await Promise.all(run.steps.map(settledStep));
  const loops = run.loops
    ? await Promise.all(
        run.loops.map(async (loop) => ({
          ...loop,
          iterations: await Promise.all(
            loop.iterations.map(async (iteration) => ({
              ...iteration,
              nodes: await Promise.all(iteration.nodes.map(settledStep)),
            })),
          ),
        })),
      )
    : undefined;
  const settled = { ...run, steps, ...(loops ? { loops } : {}) };
  const before = allPlanRunResults(run);
  const hasChanged = allPlanRunResults(settled).some(
    (step, index) => step !== before[index],
  );
  if (!hasChanged) return run;
  return settled;
}
