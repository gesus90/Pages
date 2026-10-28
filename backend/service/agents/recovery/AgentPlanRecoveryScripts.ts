import { endInterruptedScriptWithFailure } from "../AgentPlanScriptRecovery";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

/** Rechecks only local scripts whose original attempt did not confirm closeout. */
async function closeScript(
  step: AgentPlanStepResult,
  failures: AgentPlanCleanupFailure[],
): Promise<AgentPlanStepResult> {
  if (
    !step.script ||
    step.script.closeout === "confirmed" ||
    step.execution?.target.kind === "remote"
  )
    return step;
  return endInterruptedScriptWithFailure(step, (failure) =>
    failures.push(failure),
  );
}

/** Builds a temporary checked view; the persisted historical run stays unchanged. */
export async function closeRecoveryScripts(
  run: AgentPlanRun,
): Promise<AgentPlanRun> {
  const failures: AgentPlanCleanupFailure[] = [];
  const steps = await Promise.all(
    run.steps.map((step) => closeScript(step, failures)),
  );
  if (!run.loops) return checkedScripts({ ...run, steps }, failures);
  const loops = await Promise.all(
    run.loops.map(async (loop) => ({
      ...loop,
      iterations: await Promise.all(
        loop.iterations.map(async (iteration) => ({
          ...iteration,
          nodes: await Promise.all(
            iteration.nodes.map((node) => closeScript(node, failures)),
          ),
        })),
      ),
    })),
  );
  return checkedScripts({ ...run, steps, loops }, failures);
}

function checkedScripts(
  run: AgentPlanRun,
  failures: readonly AgentPlanCleanupFailure[],
): AgentPlanRun {
  const failure = failures[0];
  if (failure) throw new AgentPlanRecoveryError("cleanup_unconfirmed", failure);
  return run;
}
