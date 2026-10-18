import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanTicketIcon } from "../../plan-node-icon";

import { isFilteredTicketQuery, phaseTone } from "./ticket-picker-results";
import { useTicketTime } from "./use-ticket-time";

import type { AgentPlanPhase, AgentPlanTask } from "@/definition/AgentPlan";
import type { PlanTicketStatus } from "../../use-plan-ticket-refresh";
import type { PhaseTone } from "./ticket-picker-results";
import type { TicketPickerState } from "./use-ticket-picker";
import type { TicketTime } from "./use-ticket-time";

const TONES: Readonly<Record<PhaseTone, string>> = {
  neutral: "border-phase-neutral bg-phase-neutral-subtle",
  progress: "border-phase-progress bg-phase-progress-subtle",
  review: "border-phase-review bg-phase-review-subtle",
  done: "border-phase-done bg-phase-done-subtle",
};

interface ListProps {
  readonly state: TicketPickerState;
  readonly tasks: readonly AgentPlanTask[];
  readonly phases: readonly AgentPlanPhase[];
  readonly selectedId: string;
  readonly status: PlanTicketStatus;
  readonly onRetry?: () => void;
}

// Keeps the highlighted row in view while arrows move the highlight.
function revealRow(element: HTMLElement | null): void {
  element?.scrollIntoView({ block: "nearest" });
}

function PhaseBadge(props: {
  readonly task: AgentPlanTask;
  readonly phases: readonly AgentPlanPhase[];
}): React.ReactElement {
  const { task } = props;
  const phase = props.phases.find((entry) => entry.key === task.statusKey) ?? {
    key: task.statusKey,
    isDone: task.isDone,
  };
  return (
    <span
      className={cn(
        "relative mr-1 flex h-[1.4375rem] w-[4.125rem] shrink-0 items-center justify-center rounded-[0.375rem] border px-1.5 text-[11px] text-ticket-picker-foreground",
        TONES[phaseTone(phase)],
      )}
    >
      <span className="truncate">{task.statusName}</span>
    </span>
  );
}

function TicketRow(props: {
  readonly task: AgentPlanTask;
  readonly index: number;
  readonly time: TicketTime;
  readonly list: ListProps;
}): React.ReactElement {
  const { t } = useTranslation();
  const { task, list, time } = props;
  const isActive = list.state.active?.id === task.id;
  const isSelected = task.id === list.selectedId;
  return (
    <li
      ref={isActive ? revealRow : undefined}
      id={`${list.state.listboxId}-${props.index}`}
      role="option"
      aria-selected={isSelected}
      title={`${task.key}: ${task.title}\n${time.exact}`}
      className="relative flex h-12 cursor-pointer items-center gap-5 border-b border-ticket-picker-line last:border-b-0"
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (!isActive) list.state.highlight(task);
      }}
      onClick={() => list.state.choose(task)}
    >
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 -inset-x-2.5 rounded-[0.375rem] border border-ticket-picker-line bg-ticket-picker-hover shadow-xs"
        />
      ) : null}
      <PlanTicketIcon
        className={cn(
          "relative ml-1 size-6 shrink-0",
          isSelected ? "text-primary" : "text-ticket-picker-muted",
        )}
      />
      <span className="relative min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-3 text-[14px] leading-5 tracking-tight">
          <span
            className={cn("shrink-0 font-bold", isSelected && "text-primary")}
          >
            {task.key}
          </span>
          <span className="truncate">{task.title}</span>
        </span>
        <time
          dateTime={time.dateTime}
          className="block truncate text-[11px] leading-4 text-ticket-picker-muted"
        >
          {time.text}
        </time>
      </span>
      {isSelected ? (
        <Check
          className="relative size-4 shrink-0 text-primary"
          aria-label={t("plans.ticketPicker.selected")}
        />
      ) : null}
      <PhaseBadge task={task} phases={list.phases} />
    </li>
  );
}

/** The message in place of the list: loading, failure, no tickets or no match. */
function ListNotice(props: ListProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { state, tasks, status } = props;
  let message: string | null = null;
  let action: { readonly label: string; readonly run: () => void } | null =
    null;
  if (tasks.length === 0 && status === "loading")
    message = t("plans.ticketPicker.loading");
  else if (tasks.length === 0 && status === "error") {
    message = t("plans.ticketPicker.error");
    if (props.onRetry)
      action = { label: t("plans.ticketPicker.retry"), run: props.onRetry };
  } else if (tasks.length === 0) message = t("plans.ticketPicker.empty");
  else if (state.results.length === 0) {
    message = t("plans.ticketPicker.noMatch");
    action = { label: t("plans.ticketPicker.reset"), run: state.reset };
  }
  if (message === null) return null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[13px] text-ticket-picker-muted">
      {status === "loading" ? (
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      ) : null}
      <p role="status">{message}</p>
      {action ? (
        <button
          type="button"
          className="h-8 rounded-[0.3125rem] border border-ticket-picker-field px-3 text-[13px] text-ticket-picker-foreground hover:bg-ticket-picker-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={action.run}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The scrolling list of matches below the filters, always as tall as five rows.
 *
 * @remarks
 * The list is a listbox; focus stays in the search field, which names the
 * highlighted row as its active descendant.
 */
export function TicketPickerList(props: ListProps): React.ReactElement {
  const { t } = useTranslation();
  const describe = useTicketTime();
  const { state } = props;
  return (
    <div className="mx-4 h-[15.125rem] min-h-0 shrink border-t border-ticket-picker-line">
      <ListNotice {...props} />
      {/* The list reaches into the panel's padding, so a highlighted row
          stands out over the column edge without being clipped. */}
      <ul
        id={state.listboxId}
        role="listbox"
        aria-label={t("plans.ticketPicker.list")}
        className={cn(
          "pages-thin-scrollbar -mx-2.5 h-full overflow-y-auto overscroll-contain px-2.5",
          state.results.length === 0 && "hidden",
        )}
      >
        {state.results.map((task, index) => (
          <TicketRow
            key={task.id}
            task={task}
            index={index}
            time={describe(task, state.query.sort)}
            list={props}
          />
        ))}
      </ul>
    </div>
  );
}

/** Match count, refresh state and the keys of the list. */
export function TicketPickerFooter(props: ListProps): React.ReactElement {
  const { t } = useTranslation();
  const { state, tasks, status } = props;
  const count = isFilteredTicketQuery(state.query)
    ? t("plans.ticketPicker.matches", {
        count: state.results.length,
        total: tasks.length,
      })
    : t("plans.ticketPicker.count", { count: tasks.length });
  return (
    <footer className="mx-4 flex h-[2.3125rem] shrink-0 items-center justify-between gap-4 border-t border-ticket-picker-line text-[11px] text-ticket-picker-muted">
      <p role="status" className="flex min-w-0 items-center gap-2">
        <span className="truncate">{count}</span>
        {status === "loading" && tasks.length > 0 ? (
          <span className="truncate">
            · {t("plans.ticketPicker.refreshing")}
          </span>
        ) : null}
        {status === "error" && tasks.length > 0 && props.onRetry ? (
          <button
            type="button"
            className="truncate text-destructive underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={props.onRetry}
          >
            {t("plans.ticketPicker.refreshFailed")}
          </button>
        ) : null}
      </p>
      <p
        aria-hidden="true"
        className="hidden shrink-0 items-center gap-1.5 @min-[34rem]:flex"
      >
        <span>↑ ↓ {t("plans.ticketPicker.keys.navigate")}</span>
        <span>·</span>
        <span>{t("plans.ticketPicker.keys.choose")}</span>
        <span>·</span>
        <span>{t("plans.ticketPicker.keys.close")}</span>
      </p>
    </footer>
  );
}
