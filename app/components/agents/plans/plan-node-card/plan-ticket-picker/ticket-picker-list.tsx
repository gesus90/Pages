import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
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
        "flex h-6 max-w-28 min-w-16 shrink-0 items-center justify-center rounded-md border px-2 text-xs text-foreground",
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
      className={cn(
        "flex min-h-13 cursor-pointer items-center gap-3 rounded-lg px-2 py-2",
        isActive && "bg-muted",
      )}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (!isActive) list.state.highlight(task);
      }}
      onClick={() => list.state.choose(task)}
    >
      <PlanTicketIcon
        className={cn(
          "size-4.5 shrink-0",
          isSelected ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2 text-sm leading-5">
          <span className="shrink-0 font-semibold">{task.key}</span>
          <span className="truncate">{task.title}</span>
        </span>
        <time
          dateTime={time.dateTime}
          className="block truncate text-xs leading-4 text-muted-foreground"
        >
          {time.text}
        </time>
      </span>
      {isSelected ? (
        <Check
          className="size-4 shrink-0 text-primary"
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
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
      {status === "loading" ? (
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      ) : null}
      <p role="status">{message}</p>
      {action ? (
        <Button variant="outline" size="sm" onClick={action.run}>
          {action.label}
        </Button>
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
    <div className="h-69 min-h-30 shrink border-t border-border">
      <ListNotice {...props} />
      {/* The list reaches into the panel's padding, so a highlighted row
          stands out over the column edge while its content stays aligned
          with the fields above. */}
      <ScrollViewport
        as="ul"
        axis="vertical"
        id={state.listboxId}
        role="listbox"
        aria-label={t("plans.ticketPicker.list")}
        containerClassName={cn(
          "h-full",
          state.results.length === 0 && "hidden",
        )}
        className="-mx-2 overscroll-contain py-2"
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
      </ScrollViewport>
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
    <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border pt-3 text-xs leading-4 text-muted-foreground">
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
