import { useTranslation } from "react-i18next";

import { PlanStatusDonut } from "./plan-status-donut";
import { planTodoSummary } from "./plan-status-todo-model";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/** The selected node's observed TODO count, immediately before the existing runtime clock. */
export function PlanStatusTodoCount({
  step,
}: {
  readonly step: AgentPlanStepResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const summary = planTodoSummary(step);
  const count = summary.isConfirmed
    ? `${summary.completed}/${summary.total}`
    : "—";
  let label = t("plans.progress.noTodos");
  if (summary.isConfirmed)
    label = summary.total
      ? t("plans.progress.todoCount", {
          completed: summary.completed,
          total: summary.total,
        })
      : t("plans.progress.emptyTodos");
  const scope = [summary.tickets.join(", "), step?.name]
    .filter(Boolean)
    .join(" · ");
  const description = [scope, label].filter(Boolean).join(": ");
  return (
    <div
      role="img"
      title={description}
      aria-label={description}
      className="ml-auto flex shrink-0 items-center gap-1.75 border-l border-border pl-3 @2xl/status:ml-0"
    >
      <PlanStatusDonut
        completed={summary.isConfirmed ? summary.completed : 0}
        total={summary.total}
        tone="todos"
      />
      <span
        aria-hidden="true"
        className="text-xs leading-4.5 font-medium whitespace-nowrap tabular-nums"
      >
        {count}{" "}
        <span className="text-muted-foreground">
          {t("plans.progress.todoLabel")}
        </span>
      </span>
    </div>
  );
}
