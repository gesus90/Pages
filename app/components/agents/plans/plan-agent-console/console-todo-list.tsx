import { Check, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { Tooltip } from "@/app/components/ui/tooltip";
import { cn } from "@/app/lib/cn";

import { stepReportedAt, stepTodoList } from "../plan-agent-todo-model";
import { SIDEBAR_TITLE_CLASS } from "./console-sidebar-parts";
import { formatSecondTime } from "./console-time";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanProgressItem } from "@/definition/AgentPlanProgress";
import type { StepTodo } from "../plan-agent-todo-model";

/** Length of the fade at the lower edge of the list, in px. */
const LIST_FADE_PX = 34;
const BOTTOM_EDGE = ["bottom"] as const;

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
  readonly todo: StepTodo;
}): React.ReactElement {
  const { t } = useTranslation();
  const text = todo.contractId ? `${todo.contractId} ${todo.text}` : todo.text;
  const status = t(
    `plans.console.terminal.sidebar.todoStatus.${todo.isInterrupted ? "interrupted" : todo.status}`,
  );
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
            <ConsoleTodoStatus status={todo.status} label={status} />
            <span className="min-w-0 flex-1 truncate">{text}</span>
          </button>
        )}
      </Tooltip>
    </li>
  );
}

/**
 * What the list belongs to: the node name, then each bound ticket with its title.
 * @remarks
 * The name and the titles head the list, so its entries can name the concrete
 * steps. Tickets of records written before titles were kept show their key.
 */
function ConsoleTodoHeading({
  step,
}: {
  readonly step: AgentPlanStepResult;
}): React.ReactElement {
  const tickets = step.session?.contract?.tickets ?? [];
  return (
    <div data-todo-heading="" className="mt-0.5 min-w-0 text-[13px] leading-5">
      <p title={step.name} className="truncate font-medium">
        {step.name}
      </p>
      {tickets.map((ticket) => {
        const text = ticket.title
          ? `${ticket.key} ${ticket.title}`
          : ticket.key;
        return (
          <p
            key={ticket.id}
            title={text}
            data-todo-ticket={ticket.key}
            className="truncate text-agent-console-muted"
          >
            {text}
          </p>
        );
      })}
    </div>
  );
}

/**
 * The console's TODO block: the title, "done / total", the heading and the entries.
 * @remarks
 * The entries are the list of {@link stepTodoList}, which the run bar counts
 * too. Without any entry the block says so in the words of the run bar; the
 * node name stays the heading and never stands in for an entry. The list takes
 * the room between the title and the blocks below; when it is longer than
 * that room, only the list scrolls and fades out over its last 34 px. What
 * the agent does now, when it named it, stands as one muted line below the
 * entries.
 */
export function ConsoleTodoList({
  step,
  activity,
}: {
  readonly step: AgentPlanStepResult;
  /** What the agent does now; `null` when nothing is known. */
  readonly activity: string | null;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const list = stepTodoList(step);
  const isNative = list.source === "agent";
  const heading = t("plans.console.terminal.sidebar.todos");
  const reportedAt = stepReportedAt(step);
  return (
    <section
      aria-label={heading}
      data-console-todos=""
      className="flex min-h-0 min-w-0 flex-col min-[680px]:min-h-[7.5rem] min-[680px]:flex-1"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={SIDEBAR_TITLE_CLASS}>{heading}</h3>
        {list.total > 0 ? (
          <span
            data-todo-count=""
            className="text-[13px] text-agent-console-muted tabular-nums"
          >
            {t("plans.console.terminal.sidebar.todoCount", {
              done: list.done,
              total: list.total,
            })}
          </span>
        ) : null}
      </div>
      <ConsoleTodoHeading step={step} />
      {list.total > 0 ? (
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
          {list.todos.map((todo) => (
            <ConsoleTodoRow key={todo.id} todo={todo} />
          ))}
        </ScrollViewport>
      ) : (
        <p
          data-todo-empty=""
          className="mt-1.5 text-[13px] text-agent-console-muted min-[680px]:flex-1"
        >
          {t("plans.progress.agentTodos.empty")}
        </p>
      )}
      {activity ? (
        <p
          title={activity}
          className="mt-1 shrink-0 truncate text-[13px] text-agent-console-muted"
        >
          {activity}
        </p>
      ) : null}
      {reportedAt ? (
        <time
          dateTime={reportedAt}
          className="mt-1 shrink-0 text-xs text-agent-console-muted"
        >
          {t("plans.progress.activitySource", {
            time: formatSecondTime(reportedAt, i18n.language),
          })}
        </time>
      ) : null}
    </section>
  );
}

function ConsoleTodoStatus({
  status,
  label,
}: {
  readonly status: AgentPlanProgressItem["status"];
  /** The translated state, which names an interruption apart from a failure. */
  readonly label: string;
}): React.ReactElement {
  const isOpen =
    status !== "done" && status !== "active" && status !== "failed";
  return (
    <span
      role="img"
      aria-label={label}
      data-todo-mark={status}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-sm text-plan-todo-label",
        status === "done" && "bg-plan-todo-done",
        status === "active" && "bg-plan-todo-active",
        status === "failed" && "bg-plan-todo-failed",
        isOpen && "border-[1.5px] border-border",
      )}
    >
      {status === "done" ? (
        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      ) : null}
      {status === "active" ? (
        <RefreshCw
          aria-hidden="true"
          data-todo-spinner=""
          className="size-3 motion-safe:animate-todo-spin"
          strokeWidth={2.8}
        />
      ) : null}
      {status === "failed" ? (
        <X aria-hidden="true" className="size-3" strokeWidth={3} />
      ) : null}
    </span>
  );
}
