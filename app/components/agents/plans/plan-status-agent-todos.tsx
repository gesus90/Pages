import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import { agentTodoSummary } from "./plan-agent-todo-model";
import { TodoRow } from "./plan-status-todos";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/**
 * The TODO list the agent reported, read-only, beside the details of its step (PAGE-306).
 *
 * @remarks
 * The list has a bounded height and scrolls with soft fades at its edges. Only
 * a TODO the agent reported as in progress is marked active.
 */
export function PlanStatusAgentTodos({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const agent = agentTodoSummary(step);
  const heading = t("plans.progress.agentTodos.heading");
  return (
    <section
      aria-label={heading}
      data-agent-todos=""
      className="flex max-h-44 min-h-0 shrink-0 flex-col border-t border-border px-4 py-3 @2xl/status:max-h-none @2xl/status:w-72 @2xl/status:border-t-0 @2xl/status:border-l"
    >
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <h3 className="text-sm leading-5 font-semibold">{heading}</h3>
        {agent.isReported ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("plans.progress.agentTodos.count", {
              done: agent.done,
              total: agent.total,
            })}
          </span>
        ) : null}
      </div>
      {agent.isReported ? (
        <ScrollViewport
          as="ul"
          axis="vertical"
          aria-label={heading}
          containerClassName="mt-1 min-h-0 flex-1"
          className="overscroll-contain py-1"
        >
          {agent.todos.map((todo) => (
            <TodoRow
              key={todo.id}
              item={{ id: todo.id, text: todo.text, status: todo.status }}
            />
          ))}
        </ScrollViewport>
      ) : (
        <p className="py-2 text-xs leading-4.5 text-muted-foreground">
          {t("plans.progress.agentTodos.empty")}
        </p>
      )}
    </section>
  );
}
