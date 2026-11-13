import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanStatusDonut } from "../plan-status-donut";
import { PlanSwarmSymbol } from "./plan-swarm-badges";
import { planSwarmTodoCount, planSwarmWorkerLook } from "./plan-swarm-model";

import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";
import type {
  AgentPlanSwarmTaskView,
  AgentPlanSwarmWorkerView,
} from "@/definition/AgentPlanSwarmRun";

/**
 * The columns every lane shares (PAGE-313).
 *
 * @remarks
 * Wide: badge 60 px · model 190 px · area and subtask (rest) · locks 60 px ·
 * TODOs 130 px · arrow 28 px. Narrow: badge, model and arrow stay in the
 * first row, area and locks move into a second one; nothing scrolls sideways.
 */
export const PLAN_SWARM_LANE_COLUMNS =
  "grid grid-cols-[3.75rem_minmax(0,1fr)_1.75rem] items-center gap-x-2 gap-y-0.5 @xl/swarm:grid-cols-[3.75rem_11.875rem_minmax(0,1fr)_3.75rem_8.125rem_1.75rem]";

/** The TODO ring and count of a lane. */
export function PlanSwarmTodoProgress(props: {
  readonly todos: readonly AgentPlanAgentTodo[];
}): React.ReactElement {
  const { t } = useTranslation();
  const count = planSwarmTodoCount(props.todos);
  return (
    <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
      <PlanStatusDonut
        completed={count.done}
        total={count.total}
        tone="todos"
      />
      {t("plans.swarm.todoCount", count)}
    </span>
  );
}

/** What the third column says: the area and subtask, free, failed or not started. */
function laneText(
  worker: AgentPlanSwarmWorkerView,
  task: AgentPlanSwarmTaskView | undefined,
  translate: (key: string) => string,
): { readonly text: string; readonly tone: string } {
  if (worker.status === "not_started")
    return {
      text: translate("plans.swarm.notStarted"),
      tone: "text-xs text-muted-foreground",
    };
  if (worker.status === "failed")
    return {
      text: translate(
        `plans.swarm.failure.${worker.reason === "swarm_worker_timeout" ? "timeout" : "failed"}`,
      ),
      tone: "text-destructive",
    };
  if (!task)
    return {
      text: translate("plans.swarm.free"),
      tone: "text-muted-foreground",
    };
  const area = task.scope.join(", ");
  return {
    text: area ? `${area} · ${task.instruction}` : task.instruction,
    tone: "",
  };
}

/** The opened part of a lane: full subtask, TODOs, locks and partial result. */
function LaneDetails(props: {
  readonly id: string;
  readonly worker: AgentPlanSwarmWorkerView;
  readonly task: AgentPlanSwarmTaskView | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { worker, task } = props;
  return (
    <div
      id={props.id}
      className="flex flex-col gap-1.5 px-3 pb-3 text-xs wrap-anywhere"
      data-plan-swarm-details
    >
      {worker.reason ? (
        <p
          className={
            worker.status === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          }
        >
          {t("plans.swarm.reason", { reason: worker.reason })}
        </p>
      ) : null}
      {task ? <p>{task.instruction}</p> : null}
      {worker.todos.length > 0 ? (
        <ul
          className="flex flex-col gap-0.5"
          aria-label={t("plans.swarm.todos")}
        >
          {worker.todos.map((todo) => (
            <li
              key={todo.id}
              className={
                todo.status === "done"
                  ? "text-muted-foreground line-through"
                  : ""
              }
            >
              {todo.text}
            </li>
          ))}
        </ul>
      ) : null}
      {worker.locks.length > 0 ? (
        <p>{t("plans.swarm.heldLocks", { paths: worker.locks.join(", ") })}</p>
      ) : null}
      {task?.result ? (
        <p className="whitespace-pre-wrap">{task.result}</p>
      ) : null}
    </div>
  );
}

/** One helper lane: a row with the shared columns that opens below itself. */
export function PlanSwarmLane(props: {
  readonly worker: AgentPlanSwarmWorkerView;
  readonly task: AgentPlanSwarmTaskView | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const [isOpen, setOpen] = useState(false);
  const { worker, task } = props;
  const look = planSwarmWorkerLook(worker.status);
  const text = laneText(worker, task, t);
  const Arrow = isOpen ? ChevronDown : ChevronRight;
  return (
    <li className="border-t border-border" data-plan-swarm-lane={worker.id}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => setOpen(!isOpen)}
        className={cn(
          PLAN_SWARM_LANE_COLUMNS,
          "min-h-13 w-full px-3 py-1.5 text-left text-xs hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
        )}
      >
        <span
          className={cn(
            "flex h-6 items-center justify-center gap-0.5 rounded-md border text-[11px] font-semibold tabular-nums",
            look.className,
          )}
        >
          {worker.id}
          <PlanSwarmSymbol symbol={look.symbol} />
        </span>
        <span className="min-w-0 truncate">
          {worker.model || worker.provider}
        </span>
        <span
          className={cn(
            "col-span-2 col-start-1 row-start-2 min-w-0 truncate @xl/swarm:col-span-1 @xl/swarm:col-start-auto @xl/swarm:row-start-auto",
            text.tone,
          )}
        >
          {text.text}
        </span>
        <span className="hidden items-center gap-1 tabular-nums @xl/swarm:flex">
          {worker.locks.length > 0 ? (
            <>
              <Lock aria-hidden="true" className="size-3" />
              {worker.locks.length}
            </>
          ) : (
            "–"
          )}
        </span>
        <span className="hidden @xl/swarm:flex">
          <PlanSwarmTodoProgress todos={worker.todos} />
        </span>
        <Arrow
          aria-hidden="true"
          className="col-start-3 row-start-1 size-4 text-muted-foreground @xl/swarm:col-start-auto"
        />
        <span className="sr-only">
          {t("plans.swarm.toggleLane", { id: worker.id })}
        </span>
      </button>
      {isOpen ? <LaneDetails id={id} worker={worker} task={task} /> : null}
    </li>
  );
}
