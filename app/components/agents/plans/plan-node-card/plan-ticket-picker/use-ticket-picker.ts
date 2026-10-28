import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DEFAULT_TICKET_QUERY, findTickets } from "./ticket-picker-results";

import type { KeyboardEvent, RefObject } from "react";
import type { AgentPlanTask } from "@/definition/AgentPlan";
import type { TicketQuery, TicketSort } from "./ticket-picker-results";

/** Open state, query and keyboard highlight of one ticket choice. */
export interface TicketPickerState {
  readonly isOpen: boolean;
  readonly query: TicketQuery;
  /** The tickets that match the query, in its order. */
  readonly results: readonly AgentPlanTask[];
  /** The highlighted ticket that Enter chooses; hover and arrows move it. */
  readonly active: AgentPlanTask | null;
  readonly listboxId: string;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly toggle: () => void;
  /** Closes the choice; Escape and a choice return the focus to the field. */
  readonly close: (shouldFocusTrigger: boolean) => void;
  readonly search: (text: string) => void;
  readonly setPhases: (phases: readonly string[]) => void;
  readonly togglePhase: (key: string) => void;
  readonly sortBy: (sort: TicketSort) => void;
  readonly toggleDirection: () => void;
  readonly reset: () => void;
  readonly highlight: (task: AgentPlanTask) => void;
  readonly choose: (task: AgentPlanTask) => void;
  readonly handleSearchKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
  ) => void;
}

interface TicketPickerInput {
  readonly tasks: readonly AgentPlanTask[];
  /** The ticket of the node; only an explicit choice changes it. */
  readonly selectedId: string;
  readonly disabled: boolean;
  readonly onSelect: (taskId: string) => void;
  /** Runs when the choice opens, such as reading the tickets again. */
  readonly onOpen?: () => void;
}

const ARROW_STEPS: Partial<Record<string, number>> = {
  ArrowDown: 1,
  ArrowUp: -1,
};

/**
 * Holds the state of a ticket choice: search, phases, order and highlight.
 *
 * @remarks
 * Search, filters and order never change the node's ticket. The highlight
 * starts at the chosen ticket when it is listed, else at the first match.
 * Reopening keeps phases and order and clears the search.
 */
export function useTicketPicker(input: TicketPickerInput): TicketPickerState {
  const { i18n } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState<TicketQuery>(DEFAULT_TICKET_QUERY);
  const [activeId, setActiveId] = useState<string | null>(null);
  const listboxId = `${useId()}-tickets`;
  const trigger = useRef<HTMLButtonElement>(null);
  const isOpen = isExpanded && !input.disabled;
  const collator = new Intl.Collator(i18n.language, {
    numeric: true,
    sensitivity: "base",
  });
  const results = findTickets(input.tasks, query, collator);
  const active =
    results.find((task) => task.id === activeId) ??
    results.find((task) => task.id === input.selectedId) ??
    results.at(0) ??
    null;
  function open(): void {
    setQuery((previous) => ({ ...previous, text: "" }));
    setActiveId(null);
    setIsExpanded(true);
    input.onOpen?.();
  }
  function close(shouldFocusTrigger: boolean): void {
    setIsExpanded(false);
    // The field keeps its place on the canvas; focusing it must not pan.
    if (shouldFocusTrigger) trigger.current?.focus({ preventScroll: true });
  }
  function choose(task: AgentPlanTask): void {
    if (task.id !== input.selectedId) input.onSelect(task.id);
    close(true);
  }
  function move(step: number): void {
    // Only an empty list has no highlight; at either end the highlight stays.
    if (!active) return;
    const next = results[results.indexOf(active) + step] ?? active;
    setActiveId(next.id);
  }
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const step = ARROW_STEPS[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(step);
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (active) choose(active);
  }
  function togglePhase(key: string): void {
    setQuery((previous) => ({
      ...previous,
      phases: previous.phases.includes(key)
        ? previous.phases.filter((phase) => phase !== key)
        : [...previous.phases, key],
    }));
  }
  return {
    isOpen,
    query,
    results,
    active,
    listboxId,
    trigger,
    toggle: () => (isOpen ? close(false) : open()),
    close,
    search: (text) => setQuery((previous) => ({ ...previous, text })),
    setPhases: (phases) => setQuery((previous) => ({ ...previous, phases })),
    togglePhase,
    sortBy: (sort) =>
      setQuery((previous) => ({
        ...previous,
        sort,
        // Titles start at A, dates at the newest; the arrow turns either.
        direction: sort === "title" ? "asc" : "desc",
      })),
    toggleDirection: () =>
      setQuery((previous) => ({
        ...previous,
        direction: previous.direction === "asc" ? "desc" : "asc",
      })),
    reset: () =>
      setQuery((previous) => ({ ...previous, text: "", phases: [] })),
    highlight: (task) => setActiveId(task.id),
    choose,
    handleSearchKeyDown,
  };
}
