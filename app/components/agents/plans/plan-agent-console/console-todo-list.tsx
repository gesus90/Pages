import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import { PlanPaletteButton } from "../plan-palette-button";

import { SIDEBAR_TITLE_CLASS } from "./console-sidebar-parts";
import { ConsoleTodoStatus } from "./console-todo-status";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanContractItem } from "@/definition/AgentPlanSession";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";

const TODO_TOOLTIP_DELAY_MS = 1500;

/** The native list of the attempt the session runs now; a list of an earlier attempt never counts. */
function currentAgentTodos(
  step: AgentPlanStepResult,
): AgentPlanStepResult["agentTodos"] | null {
  const list = step.agentTodos;
  if (!list || list.todos.length === 0) return null;
  const session = step.session;
  if (session && sessionAttemptId(session, step.id) !== list.attemptId)
    return null;
  return list;
}

/** The contract entries as console entries, with their kept completion. */
function contractEntries(
  items: readonly AgentPlanContractItem[],
): readonly AgentPlanProgressItem[] {
  return items.map((item): AgentPlanProgressItem => ({
    id: item.id,
    contractId: item.id,
    text: item.text,
    status: item.checked ? "done" : "open",
  }));
}

/** The state of the step itself, for its title as the only entry; a failure needs a report, so it stays open. */
function stepEntryStatus(
  step: AgentPlanStepResult,
): AgentPlanProgressItem["status"] {
  if (step.status === "succeeded") return "done";
  if (step.status === "running") return "active";
  return "open";
}

/**
 * The entries the console lists; never empty.
 * @remarks
 * The agent's own structured plan comes first. An empty native list hides
 * nothing: the todos of the current assignment and attempt stand instead,
 * which hold the task lines of the instruction and the checklist of the
 * bound tickets. Then the acceptance criteria of the contract. Without any
 * of them the title of the step is the only entry, so the list always
 * says what the step works on.
 */
function displayedTodos(
  step: AgentPlanStepResult,
): readonly AgentPlanProgressItem[] {
  const native = currentAgentTodos(step);
  if (native) return native.todos;
  const progress = currentProgressTodos(step);
  if (progress.length > 0) return progress;
  const contract = step.session?.contract;
  if (contract && contract.todos.length > 0)
    return contractEntries(contract.todos);
  if (contract && contract.criteria.length > 0)
    return contractEntries(contract.criteria);
  return [
    {
      id: `step-${step.id}`,
      text: step.name,
      status: stepEntryStatus(step),
    },
  ];
}

/** The live todo states of the current attempt; an observation of another attempt is left out. */
function currentProgressTodos(
  step: AgentPlanStepResult,
): readonly AgentPlanProgressItem[] {
  const progress = step.progress;
  if (!progress) return [];
  const observed = progress.scope?.attemptId ?? null;
  const session = step.session;
  if (
    observed !== null &&
    session &&
    sessionAttemptId(session, step.id) !== observed
  )
    return [];
  return progress.todos;
}

/** An entry nobody finished, started or failed yet. */
function isOpenTodo(todo: AgentPlanProgressItem): boolean {
  return (
    todo.status !== "done" &&
    todo.status !== "active" &&
    todo.status !== "failed"
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
          "h-7 min-h-0 w-full cursor-default justify-start gap-2 rounded-sm px-1 py-0 text-left text-[13px] font-normal text-agent-console-foreground hover:bg-agent-console-track focus-visible:bg-agent-console-track focus-visible:outline-none xl:min-h-0 xl:gap-2 xl:px-1",
          isOpenTodo(todo) && "text-agent-console-muted",
        )}
      >
        <ConsoleTodoStatus status={todo.status} />
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </PlanPaletteButton>
    </li>
  );
}

/**
 * The console's TODO block: the title, "done / total" and the entries.
 * @remarks
 * The list is never empty, see {@link displayedTodos}. What the agent does
 * now, when it named it, stands as one muted line below the entries.
 */
export function ConsoleTodoList({
  step,
  activity,
}: {
  readonly step: AgentPlanStepResult;
  /** What the agent does now; `null` when nothing is known. */
  readonly activity: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const todos = displayedTodos(step);
  const isNative = currentAgentTodos(step) !== null;
  const done = todos.filter((todo) => todo.status === "done").length;
  const heading = t("plans.console.terminal.sidebar.todos");
  return (
    <section aria-label={heading} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={SIDEBAR_TITLE_CLASS}>{heading}</h3>
        <span
          data-todo-count=""
          className="text-[13px] text-agent-console-muted tabular-nums"
        >
          {t("plans.console.terminal.sidebar.todoCount", {
            done,
            total: todos.length,
          })}
        </span>
      </div>
      <ul
        key={isNative ? "agent" : "assignment"}
        data-agent-todo-list={isNative ? "" : undefined}
        className="mt-1.5 max-h-56 min-w-0 overflow-y-auto"
      >
        {todos.map((todo) => (
          <ConsoleTodoRow key={todo.id} todo={todo} />
        ))}
      </ul>
      {activity ? (
        <p
          title={activity}
          className="mt-1 truncate text-[13px] text-agent-console-muted"
        >
          {activity}
        </p>
      ) : null}
    </section>
  );
}
