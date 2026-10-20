import { randomUUID } from "node:crypto";

import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import { withGroupResults } from "./AgentPlanGroupResults";
import { initialLoopRuns } from "./loop/AgentPlanLoopRecord";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanRunOrigin } from "@/definition/AgentPlanRecovery";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** What a restart or resume carries over from the earlier run into the new one. */
export interface RecoveredRunStart {
  readonly origin: AgentPlanRunOrigin;
  /** Verified successful results, taken over unchanged; empty for a restart. */
  readonly reused: readonly AgentPlanStepResult[];
  /** Loop states whose completed iterations continue; a loop not named here starts empty. */
  readonly loops: readonly AgentPlanLoopRun[];
}

/**
 * The view of a new run: every node waits, with a fresh identity.
 *
 * @param userId - The executor.
 * @param snapshot - The prepared revision.
 */
export function initialPlanRun(
  userId: string,
  snapshot: AgentPlanSnapshot,
): AgentPlanRun {
  const view: AgentPlanRun = {
    id: randomUUID(),
    planId: snapshot.plan.id,
    planName: snapshot.plan.name,
    planRevision: snapshot.plan.revision,
    userId,
    startedAt: new Date().toISOString(),
    status: "running",
    stopRequested: false,
    steps: snapshot.plan.nodes.filter(isPlanFlowNode).map((node) => ({
      id: node.id,
      groupId: snapshot.steps.find((step) => step.step.id === node.id)?.groupId,
      name:
        snapshot.steps.find((step) => step.step.id === node.id)?.name ??
        (node.type === "loop" || node.type === "script"
          ? node.name
          : node.type),
      status: "waiting",
      isBlocked: false,
      cancellation: "none",
      output: null,
      error: null,
    })),
  };
  const loops = initialLoopRuns(snapshot);
  return withGroupResults(
    loops.length > 0 ? { ...view, loops } : view,
    snapshot,
  );
}

/**
 * The view of a run that a restart or resume of an earlier run starts.
 *
 * @remarks
 * Taken-over results keep their status, output and session record; the
 * scheduler treats them as completed dependencies and never starts them
 * again. Everything else waits, so the engine dispatches exactly the open
 * frontier of the earlier run.
 */
export function recoveredPlanRun(
  userId: string,
  snapshot: AgentPlanSnapshot,
  recovered: RecoveredRunStart,
): AgentPlanRun {
  const initial = initialPlanRun(userId, snapshot);
  const steps = initial.steps.map(
    (step) => recovered.reused.find((entry) => entry.id === step.id) ?? step,
  );
  const loops = initial.loops?.map(
    (loop) => recovered.loops.find((entry) => entry.id === loop.id) ?? loop,
  );
  return withGroupResults(
    {
      ...initial,
      origin: recovered.origin,
      steps,
      ...(loops ? { loops } : {}),
    },
    snapshot,
  );
}
