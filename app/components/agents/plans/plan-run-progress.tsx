import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanStatusIcon, planStatusClass } from "./plan-status";

import type {
  AgentPlanStepResult,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";
import type { AgentPlanContractItem } from "@/definition/AgentPlanSession";

function todoState(
  step: AgentPlanStepResult,
  todo: AgentPlanContractItem,
): string {
  return (
    step.session?.acceptance?.todos.find((entry) => entry.id === todo.id)
      ?.status ?? "unreported"
  );
}

/** Shows reported progress without turning runner success into checked business requirements. */
export function PlanRunProgress({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const todos = step.session?.contract?.todos ?? [];
  const current =
    step.status === "running"
      ? todos.find((todo) =>
          ["open", "unreported"].includes(todoState(step, todo)),
        )?.id
      : undefined;
  return (
    <section className="space-y-3" aria-label={t("plans.session.todos")}>
      <h4 className="text-sm font-semibold">{t("plans.session.todos")}</h4>
      {todos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("plans.details.noTodos")}
        </p>
      ) : null}
      <ol className="space-y-2">
        {todos.map((todo) => {
          const state = todoState(step, todo);
          const isCurrent = todo.id === current;
          let status: AgentPlanStepStatus = "waiting";
          if (state === "done") status = "succeeded";
          if (isCurrent) status = "running";
          let label = t("plans.details.todoWaiting");
          if (state === "done") label = t("plans.session.todoStatus.done");
          if (
            state === "missing" ||
            (state === "unreported" && step.status !== "running")
          )
            label = t("plans.session.unknown");
          if (
            state === "open" &&
            step.status !== "running" &&
            step.status !== "waiting"
          )
            label = t("plans.session.todoStatus.open");
          if (isCurrent) label = t("plans.details.todoRunning");
          return (
            <li
              key={todo.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-2 text-sm",
                planStatusClass(status),
              )}
            >
              <PlanStatusIcon status={status} />
              <span className="min-w-0 flex-1 break-words">
                {todo.text}
                {todo.ticket ? (
                  <span className="ml-1 text-xs">({todo.ticket.key})</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs">{label}</span>
            </li>
          );
        })}
      </ol>
      {current ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.details.todoHint")}
        </p>
      ) : null}
    </section>
  );
}
