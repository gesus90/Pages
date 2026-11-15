import { readOwnedScript } from "./AgentPlanScriptOwner";
import { endInterruptedSession } from "./AgentPlanRecovery";

import type { LocalSessions } from "@/backend/agents/local/LocalSessions";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** Preserves proven dispatched work and fails unavailable work without dispatching a replacement attempt. */
export function adoptedPlanView(
  previous: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
  local: LocalSessions,
): AgentPlanRun {
  const restore = (step: AgentPlanStepResult): AgentPlanStepResult => {
    if (
      step.status !== "running" ||
      step.remote ||
      (previous.status === "paused" &&
        (step.script || step.session?.runner === "api")) ||
      (step.session && local.has(step.session.instanceId))
    )
      return step;
    if (
      snapshot.plan.nodes.some(
        (node) => node.id === step.id && node.type === "loop",
      )
    )
      return step;
    return {
      ...step,
      status: "failed",
      error: step.session ? "plan_local_owner_unverified" : "plan_interrupted",
    };
  };
  return {
    ...previous,
    steps: previous.steps.map(restore),
    loops: previous.loops?.map((loop) => ({
      ...loop,
      iterations: loop.iterations.map((iteration) => ({
        ...iteration,
        nodes: iteration.nodes.map(restore),
      })),
    })),
  };
}

/** Updates every saved occurrence of the same attempt, including retained loop members. */
export function withAdoptedSession(
  run: AgentPlanRun,
  record: AgentPlanSessionRecord,
): AgentPlanRun {
  const update = (step: AgentPlanStepResult): AgentPlanStepResult =>
    step.session?.attemptId === record.attemptId
      ? { ...step, session: record }
      : step;
  return {
    ...run,
    steps: run.steps.map(update),
    loops: run.loops?.map((loop) => ({
      ...loop,
      iterations: loop.iterations.map((iteration) => ({
        ...iteration,
        nodes: iteration.nodes.map(update),
      })),
    })),
  };
}

/** Reconciles non-durable scripts and legacy sessions in a mixed run; proven or uncertain owners are never signalled here. */
export async function reconcileAdoptedRun(
  run: AgentPlanRun,
  local: LocalSessions,
): Promise<AgentPlanRun> {
  const reconcile = async (
    step: AgentPlanStepResult,
  ): Promise<AgentPlanStepResult> => {
    if (run.status === "paused" && step.script) {
      const script = await readOwnedScript(step.script.instanceId);
      if (script) return { ...step, script };
    }
    if (run.status === "paused" && step.session?.runner === "api") return step;
    if (step.remote || (step.session && local.has(step.session.instanceId)))
      return step;
    if (step.session && local.unverified().has(step.session.instanceId))
      return {
        ...step,
        session: { ...step.session, closeout: "failed" },
        error: "plan_local_owner_unverified",
      };
    return endInterruptedSession(step, run.startedAt);
  };
  const loops = await Promise.all(
    (run.loops ?? []).map(async (loop) => ({
      ...loop,
      iterations: await Promise.all(
        loop.iterations.map(async (iteration) => ({
          ...iteration,
          nodes: await Promise.all(iteration.nodes.map(reconcile)),
        })),
      ),
    })),
  );
  return {
    ...run,
    steps: await Promise.all(run.steps.map(reconcile)),
    ...(run.loops ? { loops } : {}),
  };
}
