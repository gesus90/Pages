import { endInterruptedScriptWithFailure } from "../AgentPlanScriptRecovery";
import { endInterruptedSession } from "../AgentPlanRecovery";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";

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

/** Rechecks durable local session boundaries without rewriting historical results. */
export async function closeRecoverySessions(
  run: AgentPlanRun,
): Promise<AgentPlanRun> {
  const close = (step: AgentPlanStepResult): Promise<AgentPlanStepResult> => {
    const session = step.session;
    return session && session.runner !== "api" && session.namespace
      ? endInterruptedSession(step, run.startedAt)
      : Promise.resolve(step);
  };
  const steps = await Promise.all(run.steps.map(close));
  const loops = await Promise.all(
    (run.loops ?? []).map(async (loop) => {
      const iterations = await Promise.all(
        loop.iterations.map(async (iteration) => ({
          ...iteration,
          nodes: await Promise.all(iteration.nodes.map(close)),
        })),
      );
      return checkedLoopSessions({ ...loop, iterations });
    }),
  );
  return { ...run, steps, ...(run.loops ? { loops } : {}) };
}

function checkedLoopSessions(loop: AgentPlanLoopRun): AgentPlanLoopRun {
  const nodes = loop.iterations.flatMap((iteration) => iteration.nodes);
  const contained = new Set(
    nodes.flatMap((node) => {
      const session = node.session;
      return session?.runner !== "api" &&
        session?.closeout === "confirmed" &&
        session.containment === "pid_namespace"
        ? [session.instanceId]
        : [];
    }),
  );
  const sessions = loop.sessions.map((session) =>
    session.instanceId && contained.has(session.instanceId)
      ? { ...session, state: "closed" as const, closeout: "confirmed" as const }
      : session,
  );
  const confirmed =
    sessions.every(
      (session) =>
        session.instanceId !== null &&
        session.state !== "open" &&
        (session.closeout === "confirmed" || session.closeout === "not_needed"),
    ) &&
    nodes.every(
      (node) =>
        !node.session ||
        node.session.closeout === "confirmed" ||
        node.session.closeout === "not_needed",
    );
  return {
    ...loop,
    sessions,
    cleanup: confirmed && sessions.length ? "confirmed" : loop.cleanup,
  };
}

function checkedScripts(
  run: AgentPlanRun,
  failures: readonly AgentPlanCleanupFailure[],
): AgentPlanRun {
  const failure = failures[0];
  if (failure) throw new AgentPlanRecoveryError("cleanup_unconfirmed", failure);
  return run;
}
