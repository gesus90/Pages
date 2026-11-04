import { dispatchPlanScript } from "./AgentPlanScriptDispatch";
import { createLoopHost } from "./loop/AgentPlanLoopEngineHost";
import { triggerOuterPlanStack } from "./stack/AgentPlanStackTrigger";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type {
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
  readonly dependencies: Pick<EngineDependencies, "scripts" | "runs" | "start">;
}

/**
 * Runs a script as a process or lets a stack hand over its next entry.
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
  if (node.type === "script" || node.type === "git_closeout")
    return dispatchPlanScript(active, node.id, controller, {
      scripts: dependencies.scripts,
      writes,
      runs: dependencies.runs,
    });
  if (node.type !== "stack") return null;
  return triggerOuterPlanStack(active, node, {
    writes,
    runs: dependencies.runs,
    authorize: () =>
      dependencies.start.control(active.view, active.snapshot, node),
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
