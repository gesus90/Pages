import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { focusOnMount } from "@/app/lib/focus-on-mount";

import {
  TICKET_PICKER_MENU,
  TicketPickerChips,
  TicketPickerFilters,
} from "./ticket-picker-filters";
import { TicketPickerFooter, TicketPickerList } from "./ticket-picker-list";
import { useTicketPickerPosition } from "./use-ticket-picker-position";

import type { FocusEvent } from "react";
import type { AgentPlanPhase, AgentPlanTask } from "@/definition/AgentPlan";
import type { PlanTicketStatus } from "../../use-plan-ticket-refresh";
import type { TicketPickerState } from "./use-ticket-picker";

interface PanelProps {
  readonly state: TicketPickerState;
  readonly tasks: readonly AgentPlanTask[];
  readonly phases: readonly AgentPlanPhase[];
  readonly selectedId: string;
  readonly status: PlanTicketStatus;
  readonly onRetry?: () => void;
}

/** Whether a node lies in the panel, its field or one of its menus. */
function belongsToPicker(
  node: EventTarget | null,
  panel: HTMLElement | null,
  field: HTMLElement | null,
): boolean {
  if (!(node instanceof Node)) return false;
  if (panel?.contains(node) || field?.contains(node)) return true;
  return node instanceof Element && node.closest(TICKET_PICKER_MENU) !== null;
}

// Events of the panel stay out of the card: no node selection, drag or zoom.
function keepInPanel(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

/**
 * A pointer outside the panel, its field and its menus closes it without a
 * choice; Escape closes it wherever the focus is, unless a menu of the panel
 * or the panel itself already took the key.
 */
function useOutsideClose(
  state: TicketPickerState,
  panel: HTMLElement | null,
): void {
  const { close, trigger } = state;
  useEffect(() => {
    function closeOutside(event: PointerEvent): void {
      if (!belongsToPicker(event.target, panel, trigger.current)) close(false);
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        event.target instanceof Element &&
        event.target.closest(TICKET_PICKER_MENU)
      )
        return;
      close(true);
    }
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, trigger, panel]);
}

function SearchField({ state }: Pick<PanelProps, "state">): React.ReactElement {
  const { t } = useTranslation();
  const activeIndex = state.active ? state.results.indexOf(state.active) : -1;
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ticket-picker-muted"
        aria-hidden="true"
      />
      <input
        ref={focusOnMount}
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={state.listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex === -1 ? undefined : `${state.listboxId}-${activeIndex}`
        }
        aria-label={t("plans.ticketPicker.searchLabel")}
        placeholder={t("plans.ticketPicker.search")}
        autoComplete="off"
        maxLength={200}
        value={state.query.text}
        className="h-8 w-full rounded-[0.3125rem] border border-ticket-picker-field bg-ticket-picker pr-3 pl-[2.375rem] text-[12px] text-ticket-picker-foreground outline-none placeholder:text-ticket-picker-muted focus:border-ticket-picker-outline focus:shadow-[inset_0_0_0_1px_var(--color-ticket-picker-outline)] [&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => state.search(event.currentTarget.value)}
        onKeyDown={state.handleSearchKeyDown}
      />
    </div>
  );
}

/**
 * The open ticket choice in a portal above the canvas: search, Kanban phase,
 * order, phase chips, matches and their count.
 *
 * @remarks
 * The portal keeps the panel out of the node's overflow and the canvas zoom.
 * Escape and a pointer outside close it; keys typed in it never reach the
 * canvas, so Delete edits the search instead of removing a node.
 */
export function TicketPickerPanel(props: PanelProps): React.ReactElement {
  const { t } = useTranslation();
  const { state } = props;
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const style = useTicketPickerPosition(state.trigger.current, panel);
  useOutsideClose(state, panel);
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // Ctrl+S or Cmd+S still saves the plan, as everywhere on the page.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")
      return;
    event.stopPropagation();
    if (event.key !== "Escape") return;
    if (
      event.target instanceof Element &&
      event.target.closest(TICKET_PICKER_MENU)
    )
      return;
    event.preventDefault();
    state.close(true);
  }
  // The retry button disappears with the failure; the search keeps the focus.
  const retry = props.onRetry
    ? (): void => {
        props.onRetry?.();
        panel?.querySelector<HTMLInputElement>("input[type=search]")?.focus();
      }
    : undefined;
  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    if (
      event.relatedTarget !== null &&
      !belongsToPicker(event.relatedTarget, panel, state.trigger.current)
    )
      state.close(false);
  }
  return createPortal(
    <div
      ref={setPanel}
      role="dialog"
      aria-label={t("plans.ticketPicker.dialog")}
      style={style}
      className="@container z-50 flex w-[40.625rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-[0.5625rem] border border-ticket-picker-outline bg-ticket-picker text-ticket-picker-foreground shadow-panel select-none"
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPointerDown={keepInPanel}
      onClick={keepInPanel}
      onDoubleClick={keepInPanel}
      onWheel={keepInPanel}
    >
      <div className="shrink-0 px-4 pt-[0.9375rem]">
        <SearchField state={state} />
        <TicketPickerFilters state={state} phases={props.phases} />
        <TicketPickerChips state={state} phases={props.phases} />
      </div>
      <TicketPickerList {...props} onRetry={retry} />
      <TicketPickerFooter {...props} onRetry={retry} />
    </div>,
    document.body,
  );
}
