import { dispatchPlanScript } from "./AgentPlanScriptDispatch";
import { createLoopHost } from "./loop/AgentPlanLoopEngineHost";
import { triggerOuterPlanStack } from "./stack/AgentPlanStackTrigger";
import { invalidDecisionInput } from "./branching/AgentPlanDecisionValue";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type {
  AgentPlanDecision,
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanLoopRunner } from "./loop/AgentPlanLoopRunner";

/** What the engine lends the dispatch of a node that is no agent session. */
export interface PlanNodeDispatchContext {
  readonly writes: SerialQueue;
  readonly dependencies: Pick<
    EngineDependencies,
    "scripts" | "runs" | "start" | "decisions"
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
  if (node.type === "script")
    return dispatchPlanScript(active, node.id, controller, {
      scripts: dependencies.scripts,
      writes,
      runs: dependencies.runs,
    });
  if (node.type === "decision")
    return dispatchPlanDecision(active, node, controller, context);
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
