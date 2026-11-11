import { useTranslation } from "react-i18next";

import { agentTodoSummary } from "./plan-agent-todo-model";
import { PlanStatusDonut } from "./plan-status-donut";
import { planTodoSummary } from "./plan-status-todo-model";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentTodoSummary } from "./plan-agent-todo-model";

interface TodoCountProps {
  readonly step: AgentPlanStepResult | undefined;
}

const COUNT_CLASS =
  "ml-auto flex shrink-0 items-center gap-1.75 border-l border-border pl-3 @2xl/status:ml-0";

/** The TODO list the agent reported: the one in progress and "x von y erledigt". */
function AgentTodoCount({
  step,
  agent,
}: TodoCountProps & {
  readonly agent: AgentTodoSummary;
}): React.ReactElement {
  const { t } = useTranslation();
  const count = t("plans.progress.agentTodos.count", {
    done: agent.done,
    total: agent.total,
  });
  const current = agent.current
    ? t("plans.progress.agentTodos.current", { text: agent.current.text })
    : t("plans.progress.agentTodos.noCurrent");
  const description = [step?.name, count, current].filter(Boolean).join(": ");
  return (
    <div
      role="img"
      title={description}
      aria-label={description}
      data-agent-todo-count=""
      className={COUNT_CLASS}
    >
      <PlanStatusDonut
        completed={agent.done}
        total={agent.total}
        tone="todos"
      />
      <span aria-hidden="true" className="min-w-0">
        <span className="block text-xs leading-4 font-medium whitespace-nowrap tabular-nums">
          {count}
        </span>
        <span className="block max-w-40 truncate text-[0.6875rem] leading-3.5 text-muted-foreground">
          {current}
        </span>
      </span>
    </div>
  );
}

/** What an agent step without a reported list says, instead of a count. */
function NoAgentTodos({ step }: TodoCountProps): React.ReactElement {
  const { t } = useTranslation();
  const label = t("plans.progress.agentTodos.empty");
  return (
    <div
      role="img"
      title={`${step?.name ?? ""}: ${label}`}
      aria-label={label}
      data-agent-todo-count="empty"
      className={COUNT_CLASS}
    >
      <span
        aria-hidden="true"
        className="max-w-44 truncate text-xs leading-4.5 text-muted-foreground"
      >
        {label}
      </span>
    </div>
  );
}

/**
 * The selected node's TODO progress, immediately before the existing runtime clock.
 *
 * @remarks
 * A list the CLI reported wins. Without one, a node with observed ticket
 * entries keeps its checklist count; every other agent step says that no
 * list was reported, and never guesses one from text.
 */
export function PlanStatusTodoCount({
  step,
}: TodoCountProps): React.ReactElement {
  const { t } = useTranslation();
  const agent = agentTodoSummary(step);
  if (agent.isReported) return <AgentTodoCount step={step} agent={agent} />;
  const summary = planTodoSummary(step);
  if (!summary.isConfirmed && step?.session)
    return <NoAgentTodos step={step} />;
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
      className={COUNT_CLASS}
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
