import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanPaletteButton } from "../plan-palette-button";

import { ConsoleTodoStatus } from "./console-todo-status";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";

const TODO_TOOLTIP_DELAY_MS = 1500;

function displayedTodos(
  step: AgentPlanStepResult,
): readonly AgentPlanProgressItem[] {
  if (step.agentTodos) return step.agentTodos.todos;
  return (
    step.progress?.todos ??
    step.session?.contract?.todos.map((todo): AgentPlanProgressItem => ({
      id: todo.id,
      contractId: todo.id,
      text: todo.text,
      status: todo.checked ? "done" : "open",
    })) ??
    []
  );
}

function ConsoleTodoRow({
  todo,
}: {
  readonly todo: AgentPlanProgressItem;
}): React.ReactElement {
  const { t } = useTranslation();
  const text = todo.contractId ? `${todo.contractId} ${todo.text}` : todo.text;
  const status = t(`plans.console.terminal.sidebar.todoStatus.${todo.status}`);
  return (
    <li className="min-w-0">
      <PlanPaletteButton
        tooltip={text}
        aria-label={`${status}: ${text}`}
        hoverDelayMs={TODO_TOOLTIP_DELAY_MS}
        variant="ghost"
        className={cn(
          "h-7 min-h-0 w-full cursor-default justify-start gap-2 rounded-sm px-1 py-0 text-left text-sm font-normal text-agent-console-foreground hover:bg-agent-console-track focus-visible:bg-agent-console-track focus-visible:outline-none xl:min-h-0 xl:gap-2 xl:px-1",
          todo.status === "active" && "font-semibold",
        )}
      >
        <ConsoleTodoStatus status={todo.status} />
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </PlanPaletteButton>
    </li>
  );
}

/** The console's single TODO section: structured agent plan first, assignment only as fallback. */
export function ConsoleTodoList({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const todos = displayedTodos(step);
  const done = todos.filter((todo) => todo.status === "done").length;
  const heading = t("plans.console.terminal.sidebar.todos");
  return (
    <section aria-label={heading} className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-agent-console-foreground">
          {heading}
        </h3>
        <span className="text-xs text-agent-console-muted tabular-nums">
          {t("plans.console.terminal.sidebar.todoCount", {
            done,
            total: todos.length,
          })}
        </span>
      </div>
      {todos.length > 0 ? (
        <ul
          key={step.agentTodos ? "agent" : "assignment"}
          data-agent-todo-list={step.agentTodos ? "" : undefined}
          className="max-h-56 min-w-0 overflow-y-auto text-sm"
        >
          {todos.map((todo) => (
            <ConsoleTodoRow key={todo.id} todo={todo} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-agent-console-muted">
          {t("plans.console.terminal.sidebar.noTodos")}
        </p>
      )}
    </section>
  );
}
