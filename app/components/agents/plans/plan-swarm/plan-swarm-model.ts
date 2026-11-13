import {
  PLAN_SWARM_BADGES_PER_ROW,
  planSwarmWorkerLabel,
  planSwarmWorkerList,
} from "@/definition/AgentPlanSwarm";

import { planStatusClass } from "../plan-status";

import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";
import type {
  AgentPlanSwarmRun,
  AgentPlanSwarmWorkerView,
} from "@/definition/AgentPlanSwarmRun";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";

/** The symbol a badge shows beside its label; `null` shows none. */
export type PlanSwarmBadgeSymbol =
  "busy" | "done" | "failed" | "notStarted" | null;

/** One helper badge of a swarm card: label, colors, symbol and tooltip parts. */
export interface PlanSwarmBadge {
  readonly id: string;
  /** The classes of the plan status the badge takes; before a run the swarm type color. */
  readonly className: string;
  readonly symbol: PlanSwarmBadgeSymbol;
  readonly model: string;
  /** The current subtask of the helper, for the tooltip. */
  readonly task: string | null;
}

/** The badge colors before a run: the swarm type color on the surface. */
export const PLAN_SWARM_IDLE_BADGE =
  "border-plan-swarm-edge bg-surface text-plan-swarm";

/**
 * The colors and symbol of a helper in a run, with the existing plan status classes.
 *
 * @remarks
 * Waiting and free are `muted` without a symbol, busy is `status-active`
 * with the spinning circle, finished is `success` with a check, failed is
 * `destructive` with a cross. A helper that could not start stays `muted`
 * with the slashed circle: it is no failure of the node.
 */
export function planSwarmWorkerLook(
  status: AgentPlanSwarmWorkerView["status"],
): {
  readonly className: string;
  readonly symbol: PlanSwarmBadgeSymbol;
} {
  switch (status) {
    case "busy":
    case "starting":
      return { className: planStatusClass("running"), symbol: "busy" };
    case "done":
      return { className: planStatusClass("succeeded"), symbol: "done" };
    case "failed":
      return { className: planStatusClass("failed"), symbol: "failed" };
    case "not_started":
      return { className: planStatusClass("waiting"), symbol: "notStarted" };
    case "idle":
      return { className: planStatusClass("waiting"), symbol: null };
  }
}

function modelName(provider: string, model: string): string {
  return model ? model : provider;
}

/**
 * The badges of a swarm card, H1 first.
 *
 * @param swarm - The configured swarm.
 * @param run - Its lanes in the shown run, or `undefined` before one.
 */
export function planSwarmBadges(
  swarm: AgentPlanSwarm,
  run: AgentPlanSwarmRun | undefined,
): readonly PlanSwarmBadge[] {
  const configured = planSwarmWorkerList(swarm.workers);
  return configured.map((worker, index) => {
    const id = planSwarmWorkerLabel(index);
    const lane = run?.workers.find((entry) => entry.id === id);
    if (!lane)
      return {
        id,
        className: PLAN_SWARM_IDLE_BADGE,
        symbol: null,
        model: worker.model
          ? modelName(worker.model.provider, worker.model.model)
          : "",
        task: null,
      };
    const look = planSwarmWorkerLook(lane.status);
    const task = lane.taskId
      ? (run?.tasks.find((entry) => entry.id === lane.taskId)?.instruction ??
        null)
      : null;
    return {
      id,
      className: look.className,
      symbol: look.symbol,
      model: modelName(lane.provider, lane.model),
      task,
    };
  });
}

/** Splits the badges into rows of at most five; from six helpers on there is a second row. */
export function planSwarmBadgeRows<Entry>(
  badges: readonly Entry[],
): readonly (readonly Entry[])[] {
  const rows: Entry[][] = [];
  for (let index = 0; index < badges.length; index += PLAN_SWARM_BADGES_PER_ROW)
    rows.push(badges.slice(index, index + PLAN_SWARM_BADGES_PER_ROW));
  return rows;
}

/** How many TODOs of a list are done and how many there are. */
export function planSwarmTodoCount(todos: readonly AgentPlanAgentTodo[]): {
  readonly done: number;
  readonly total: number;
} {
  return {
    done: todos.filter((todo) => todo.status === "done").length,
    total: todos.length,
  };
}

/** Whether a helper could not start, the reason of its lane. */
export function isPlanSwarmNotStarted(
  worker: AgentPlanSwarmWorkerView,
): boolean {
  return worker.status === "not_started";
}

/** What the lane of a run shows: still empty, loading, or with subtasks. */
export type PlanSwarmRunState = "empty" | "loading" | "active";

/**
 * The state of the run view of a swarm.
 *
 * @param run - The lanes of the run; `undefined` while they load.
 */
export function planSwarmRunState(
  run: AgentPlanSwarmRun | undefined,
): PlanSwarmRunState {
  if (!run) return "loading";
  return run.tasks.length === 0 ? "empty" : "active";
}
