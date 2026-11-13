import { dispatchPlanScript } from "./AgentPlanScriptDispatch";
import { skippedPlanScriptResult } from "./AgentPlanScriptResult";
import { createLoopHost } from "./loop/AgentPlanLoopEngineHost";
import { triggerOuterPlanStack } from "./stack/AgentPlanStackTrigger";
import { invalidDecisionInput } from "./branching/AgentPlanDecisionValue";
import { patchStep } from "./AgentPlanRunState";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type {
  AgentPlanDecision,
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanLoopRunner } from "./loop/AgentPlanLoopRunner";

/** What the engine lends the dispatch of a node that is no agent session. */
export interface PlanNodeDispatchContext {
  readonly writes: SerialQueue;
  readonly dependencies: Pick<
    EngineDependencies,
    "scripts" | "runs" | "start" | "decisions" | "swarms"
  >;
}

/**
 * Runs a script as a process, lets a stack hand over its next entry or asks the model of a decision.
 *
 * @returns The outcome, or `null` for every other node.
 */
export function dispatchPlanLocalNode(
  active: ActivePlanRun,
  node: AgentPlanNode,
  controller: AbortController,
  context: PlanNodeDispatchContext,
): Promise<Partial<AgentPlanStepResult>> | null {
  const { writes, dependencies } = context;
  // A Git closeout of an earlier version is never run, not even from a run frozen before the upgrade.
  if (node.type === "git_closeout") {
    active.dispatched.delete(node.id);
    return Promise.resolve({
      status: "failed",
      error: "plan_git_closeout_unsupported",
    });
  }
  if (node.type === "script" && node.disabled) {
    active.dispatched.delete(node.id);
    return Promise.resolve(skippedPlanScriptResult(node));
  }
  if (node.type === "script")
    return dispatchPlanScript(active, node.id, controller, {
      scripts: dependencies.scripts,
      writes,
      runs: dependencies.runs,
    });
  if (node.type === "decision")
    return dispatchPlanDecision(active, node, controller, context);
  if (node.type === "swarm")
    return dispatchPlanSwarm(active, node, controller, context);
  if (node.type !== "stack") return null;
  return triggerOuterPlanStack(active, node, {
    writes,
    runs: dependencies.runs,
    authorize: () =>
      dependencies.start.control(active.view, active.snapshot, node),
  });
}

/** A model decision of the outer graph asks its model in a session of its own; a boolean one never gets here. */
function dispatchPlanDecision(
  active: ActivePlanRun,
  node: AgentPlanDecision,
  controller: AbortController,
  context: PlanNodeDispatchContext,
): Promise<Partial<AgentPlanStepResult>> {
  const { decisions, start } = context.dependencies;
  if (!decisions) return Promise.resolve(invalidDecisionInput());
  return decisions.run({
    run: active.view,
    snapshot: active.snapshot,
    decision: node,
    results: new Map(active.view.steps.map((step) => [step.id, step])),
    signal: controller.signal,
    authorize: () => start.control(active.view, active.snapshot, node),
  });
}

/**
 * A swarm runs its main model and helpers in sessions of their own (PAGE-313).
 *
 * @remarks
 * Its lanes and board are written into the node result after every change,
 * through the engine's write queue, so the run view shows them live.
 */
function dispatchPlanSwarm(
  active: ActivePlanRun,
  node: AgentPlanSwarm,
  controller: AbortController,
  context: PlanNodeDispatchContext,
): Promise<Partial<AgentPlanStepResult>> {
  const { swarms, start, runs } = context.dependencies;
  if (!swarms)
    return Promise.resolve({
      status: "failed",
      error: "plan_session_unavailable",
      output: null,
    });
  return swarms.run({
    run: active.view,
    snapshot: active.snapshot,
    node,
    signal: controller.signal,
    authorize: () => start.control(active.view, active.snapshot, node),
    save: (swarm) =>
      context.writes.run(async () => {
        if (
          active.view.steps.find((step) => step.id === node.id)?.status !==
          "running"
        )
          return;
        patchStep(active, node.id, { swarm });
        await runs.update(active.view);
      }),
  });
}

/** A loop is one node: its iterations run inside it and it settles only when they have. */
export function dispatchPlanLoop(
  active: ActivePlanRun,
  node: AgentPlanLoop,
  controller: AbortController,
  context: PlanNodeDispatchContext & {
    readonly loops: Pick<AgentPlanLoopRunner, "run">;
  },
): Promise<Partial<AgentPlanStepResult>> {
  const host = createLoopHost(active, controller.signal, {
    writes: context.writes,
    runs: context.dependencies.runs,
    authorize: () =>
      context.dependencies.start.control(active.view, active.snapshot, node),
  });
  return context.loops.run(node, host);
}
