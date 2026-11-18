import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Tooltip } from "@/app/components/ui/tooltip";
import { cn } from "@/app/lib/cn";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import { SIDEBAR_TITLE_CLASS } from "./console-sidebar-parts";
import { ConsoleTodoStatus } from "./console-todo-status";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanContractItem } from "@/definition/AgentPlanSession";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";

/** Length of the fade at the lower edge of the list, in px. */
const LIST_FADE_PX = 34;
const BOTTOM_EDGE = ["bottom"] as const;

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

/**
 * One entry: exactly one line of 28 px, the mark, then the text cut with „…“.
 * @remarks
 * A finished entry is muted, the current one bold. The full text stands in a
 * tooltip that opens after 1.5 s of rest, or at once on keyboard focus, and
 * is drawn outside the scroll area of the list, so the list never cuts it.
 */
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
      <Tooltip content={text} isFloating className="flex w-full min-w-0">
        {(tooltipId) => (
          <button
            type="button"
            aria-label={`${status}: ${text}`}
            aria-describedby={tooltipId}
            className={cn(
              "flex h-7 w-full min-w-0 cursor-default items-center gap-2.5 rounded-md px-1 text-left text-[13px] leading-5 text-agent-console-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
              todo.status === "done" && "text-agent-console-muted",
              todo.status === "active" && "font-semibold",
            )}
          >
            <ConsoleTodoStatus status={todo.status} />
            <span className="min-w-0 flex-1 truncate">{text}</span>
          </button>
        )}
      </Tooltip>
    </li>
  );
}

/**
 * The console's TODO block: the title, "done / total" and the entries.
 * @remarks
 * The list is never empty, see {@link displayedTodos}. It takes the room
 * between the title and the blocks below; when it is longer than that room,
 * only the list scrolls and fades out over its last 34 px. What the agent
 * does now, when it named it, stands as one muted line below the entries.
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
    <section
      aria-label={heading}
      data-console-todos=""
      className="flex min-h-0 min-w-0 flex-col min-[680px]:min-h-[7.5rem] min-[680px]:flex-1"
    >
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
      <ScrollViewport
        as="ul"
        key={isNative ? "agent" : "assignment"}
        data-agent-todo-list={isNative ? "" : undefined}
        fadeMode="mask"
        fadeEdges={BOTTOM_EDGE}
        fadeBottom={LIST_FADE_PX}
        containerClassName="mt-1.5 max-h-56 min-[680px]:max-h-none min-[680px]:flex-1"
        className="min-w-0"
      >
        {todos.map((todo) => (
          <ConsoleTodoRow key={todo.id} todo={todo} />
        ))}
      </ScrollViewport>
      {activity ? (
        <p
          title={activity}
          className="mt-1 shrink-0 truncate text-[13px] text-agent-console-muted"
        >
          {activity}
        </p>
      ) : null}
    </section>
  );
}
