import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { TicketPickerPanel } from "./plan-ticket-picker/ticket-picker-panel";
import { useTicketPicker } from "./plan-ticket-picker/use-ticket-picker";

import type { AgentPlanTask } from "@/definition/AgentPlan";

interface PlanTicketPickerProps {
  /** The node's ticket; empty while none is chosen. */
  readonly taskId: string;
  /** The accessible name of the field. */
  readonly label: string;
  readonly disabled: boolean;
  readonly onSelect: (taskId: string) => void;
}

// Opening the choice selects no node and starts no drag or pan.
function keepOnField(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

function FieldText(props: {
  readonly taskId: string;
  readonly task: AgentPlanTask | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { task } = props;
  if (task)
    return (
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 font-semibold">{task.key}</span>
        <span className="truncate">{task.title}</span>
      </span>
    );
  if (props.taskId)
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-destructive">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("plans.ticketUnavailable")}</span>
      </span>
    );
  return (
    <span className="min-w-0 flex-1 truncate">
      {t("plans.ticketPicker.choose")}
    </span>
  );
}

/**
 * The ticket field of a ticket card and its large choice below it.
 *
 * @remarks
 * Only choosing a row changes the node's ticket. A ticket that is gone or
 * hidden stays the node's reference and is named unavailable, without its
 * identifier. Opening the choice reads the tickets of the project again.
 */
export function PlanTicketPicker(
  props: PlanTicketPickerProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { sources, tickets } = usePlanFlowContext();
  const state = useTicketPicker({
    tasks: sources.tasks,
    selectedId: props.taskId,
    disabled: props.disabled,
    onSelect: props.onSelect,
    onOpen: tickets?.refresh,
  });
  const task = sources.tasks.find((entry) => entry.id === props.taskId);
  const Chevron = state.isOpen ? ChevronUp : ChevronDown;
  let title = t("plans.ticketUnavailableHint");
  if (task) title = `${task.key}: ${task.title} · ${task.statusName}`;
  function handleFieldKeys(
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void {
    if (event.key === "Escape" && state.isOpen) {
      event.preventDefault();
      event.stopPropagation();
      state.close(true);
      return;
    }
    if (event.key !== "ArrowDown" || state.isOpen) return;
    event.preventDefault();
    state.toggle();
  }
  return (
    <>
      <button
        ref={state.trigger}
        type="button"
        role="combobox"
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={state.isOpen}
        aria-controls={state.isOpen ? state.listboxId : undefined}
        aria-invalid={Boolean(props.taskId) && !task}
        title={props.taskId ? title : undefined}
        disabled={props.disabled}
        className={cn(
          "nodrag nopan nokey flex h-8 w-full min-w-0 items-center gap-2 rounded-[0.3125rem] border border-ticket-picker-outline bg-ticket-picker pr-2.5 pl-2.5 text-left text-[13px] text-ticket-picker-foreground outline-none hover:bg-ticket-picker-hover focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-70",
          Boolean(props.taskId) && !task && "border-destructive",
        )}
        onPointerDown={keepOnField}
        onClick={(event) => {
          keepOnField(event);
          state.toggle();
        }}
        onDoubleClick={keepOnField}
        onKeyDown={handleFieldKeys}
      >
        <FieldText taskId={props.taskId} task={task} />
        <Chevron className="size-4 shrink-0" aria-hidden="true" />
      </button>
      {state.isOpen ? (
        <TicketPickerPanel
          state={state}
          tasks={sources.tasks}
          phases={sources.phases ?? []}
          selectedId={props.taskId}
          status={tickets?.status ?? "idle"}
          onRetry={tickets?.refresh}
        />
      ) : null}
    </>
  );
}
