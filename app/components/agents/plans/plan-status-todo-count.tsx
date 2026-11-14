import { useTranslation } from "react-i18next";

import { agentTodoSummary } from "./plan-agent-todo-model";
import { PlanStatusDonut } from "./plan-status-donut";

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
  const tickets = step?.progress?.tickets
    ?.map((ticket) => ticket.key)
    .join(", ");
  const description = [tickets, step?.name, count, current]
    .filter(Boolean)
    .join(": ");
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
 * Counts the assignment and structured agent plans together, including before
 * the agent reports progress. An empty assignment is shown explicitly.
 */
export function PlanStatusTodoCount({
  step,
}: TodoCountProps): React.ReactElement {
  const agent = agentTodoSummary(step);
  if (agent.isReported) return <AgentTodoCount step={step} agent={agent} />;
  return <NoAgentTodos step={step} />;
}
