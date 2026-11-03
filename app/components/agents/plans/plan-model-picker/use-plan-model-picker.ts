import { useEffect, useId, useRef, useState } from "react";

import { visibleBand } from "@/app/components/ui/searchable-select/use-searchable-select";

import {
  filterPlanModelGroups,
  findPlanModelChoice,
} from "./plan-model-catalog";

import type { FocusEvent, KeyboardEvent, RefObject } from "react";
import type { PlanModelChoice, PlanModelGroup } from "./plan-model-catalog";

/** A row the keyboard can reach: a tool's header or one of its models. */
export type PlanPickerItem =
  | {
      readonly kind: "group";
      readonly key: string;
      readonly group: PlanModelGroup;
    }
  | {
      readonly kind: "model";
      readonly key: string;
      readonly groupKey: string;
      readonly choice: PlanModelChoice;
    };

/** Where the open panel lies and how high its list may grow. */
interface PlanPickerLayout {
  readonly placement: "below" | "above";
  readonly listHeight: number;
}

/** State of the model choice, shared by its trigger and its panel. */
export interface PlanModelPickerState {
  readonly isOpen: boolean;
  readonly query: string;
  readonly isSearching: boolean;
  readonly layout: PlanPickerLayout;
  /** The groups and models that match the search, collapsed groups included. */
  readonly groups: readonly PlanModelGroup[];
  /** The rows in the order they are listed: headers and models of open groups. */
  readonly items: readonly PlanPickerItem[];
  readonly active: PlanPickerItem | null;
  readonly treeId: string;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  /** The scrolling list, which a new search shows from its first match. */
  readonly list: RefObject<HTMLElement | null>;
  readonly isExpanded: (groupKey: string) => boolean;
  /** The element ID of a listed row, for `aria-activedescendant`. */
  readonly itemId: (key: string) => string;
  readonly toggle: () => void;
  readonly search: (query: string) => void;
  readonly toggleGroup: (groupKey: string) => void;
  readonly highlight: (key: string) => void;
  readonly choose: (choice: PlanModelChoice) => void;
  readonly handleTriggerKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void;
  readonly handleSearchKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
  ) => void;
  readonly handleBlur: (event: FocusEvent<HTMLDivElement>) => void;
}

/** Room of the search field and footer around the list. */
const PANEL_CHROME = 104;
// Below the minimum a surrounding dialog scrolls to show the whole panel.
const LIST_HEIGHT = { min: 320, max: 480 } as const;
const ARROW_OFFSETS: Partial<Record<string, number>> = {
  ArrowDown: 1,
  ArrowUp: -1,
};

/**
 * The row key of a tool's header.
 *
 * @param key - The tool's group key.
 * @returns A key no model row shares.
 */
export function planGroupKey(key: string): string {
  return `group:${key}`;
}

/**
 * The row key of a model.
 *
 * @param id - The model's selection key.
 * @returns A key no header row shares.
 */
export function planModelKey(id: string): string {
  return `model:${id}`;
}

// Opens above the trigger only where the whole panel fits there: content
// above a scrolling dialog's top cannot be scrolled to, content below can.
function measureLayout(trigger: HTMLElement | null): PlanPickerLayout {
  if (!trigger) return { placement: "below", listHeight: LIST_HEIGHT.max };
  const band = visibleBand(trigger);
  const bounds = trigger.getBoundingClientRect();
  const below = band.bottom - bounds.bottom - PANEL_CHROME;
  const above = bounds.top - band.top - PANEL_CHROME;
  if (below < LIST_HEIGHT.min && above >= LIST_HEIGHT.min)
    return { placement: "above", listHeight: Math.min(LIST_HEIGHT.max, above) };
  return {
    placement: "below",
    listHeight: Math.min(LIST_HEIGHT.max, Math.max(LIST_HEIGHT.min, below)),
  };
}

function listedItems(
  groups: readonly PlanModelGroup[],
  isExpanded: (groupKey: string) => boolean,
): PlanPickerItem[] {
  return groups.flatMap((group): PlanPickerItem[] => [
    { kind: "group", key: planGroupKey(group.key), group },
    ...(isExpanded(group.key)
      ? group.sources.flatMap((source) =>
          source.choices.map((choice): PlanPickerItem => ({
            kind: "model",
            key: planModelKey(choice.model.id),
            groupKey: group.key,
            choice,
          })),
        )
      : []),
  ]);
}

function toggled(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(keys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Closes the panel on Escape before a surrounding dialog hears the key. */
function useEscapeClose(isOpen: boolean, close: () => void): void {
  useEffect(() => {
    if (!isOpen) return undefined;
    function closeOnEscape(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [isOpen, close]);
}

/** The open and collapsed groups: the person's own choice, and a separate one while searching. */
function useGroupExpansion(input: {
  readonly groups: readonly PlanModelGroup[];
  readonly value: string;
}): {
  readonly expanded: ReadonlySet<string>;
  readonly setExpanded: (keys: ReadonlySet<string>) => void;
  readonly searchClosed: ReadonlySet<string>;
  readonly setSearchClosed: (keys: ReadonlySet<string>) => void;
} {
  // The tool of the saved model starts open; the person decides the rest.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const selected = findPlanModelChoice(input.groups, input.value);
    return new Set(selected ? [selected.group.key] : []);
  });
  // A search opens every matching group; closing one there leaves the
  // person's own choice untouched, so clearing the search restores it.
  const [searchClosed, setSearchClosed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  return { expanded, setExpanded, searchClosed, setSearchClosed };
}

/**
 * Holds the open state, search, collapsed tools and keyboard highlight of the model choice.
 *
 * @remarks
 * Focus stays in the search field while the panel is open, as in the
 * combobox pattern of the ARIA Authoring Practices with a tree popup. Arrow
 * Up and Down move over tool headers and the models of open tools, Enter
 * opens or closes a tool or chooses a model, Arrow Right and Left open and
 * close a tool while the search is empty, and Escape closes only the panel.
 */
export function usePlanModelPicker(input: {
  readonly value: string;
  readonly groups: readonly PlanModelGroup[];
  readonly onChange: (id: string) => void;
  readonly disabled: boolean;
}): PlanModelPickerState {
  const [isOpenState, setIsOpen] = useState(false);
  const isOpen = isOpenState && !input.disabled;
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<PlanPickerLayout>(() =>
    measureLayout(null),
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const expansion = useGroupExpansion(input);
  const treeId = `${useId()}-tree`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLElement>(null);
  const isSearching = query.trim() !== "";
  const groups = filterPlanModelGroups(input.groups, query);
  function isExpanded(groupKey: string): boolean {
    return isSearching
      ? !expansion.searchClosed.has(groupKey)
      : expansion.expanded.has(groupKey);
  }
  const items = listedItems(groups, isExpanded);
  const active =
    items.find((item) => item.key === activeKey) ??
    // A search starts at its first match, so Enter chooses it and the list
    // shows the matches from the top; otherwise the saved model is highlighted.
    (isSearching
      ? items.find((item) => item.kind === "model")
      : items.find((item) => item.key === planModelKey(input.value))) ??
    items.at(0) ??
    null;
  const closeRef = useRef(() => {
    setIsOpen(false);
    trigger.current?.focus();
  });
  useEscapeClose(isOpen, closeRef.current);

  function open(): void {
    const selected = findPlanModelChoice(input.groups, input.value);
    if (selected && !expansion.expanded.has(selected.group.key))
      expansion.setExpanded(toggled(expansion.expanded, selected.group.key));
    setQuery("");
    expansion.setSearchClosed(new Set());
    setActiveKey(selected ? planModelKey(input.value) : null);
    setLayout(measureLayout(trigger.current));
    setIsOpen(true);
  }

  function toggleGroup(groupKey: string): void {
    if (isSearching)
      expansion.setSearchClosed(toggled(expansion.searchClosed, groupKey));
    else expansion.setExpanded(toggled(expansion.expanded, groupKey));
    setActiveKey(planGroupKey(groupKey));
  }

  function choose(choice: PlanModelChoice): void {
    input.onChange(choice.model.id);
    closeRef.current();
  }

  return {
    isOpen,
    query,
    isSearching,
    layout,
    groups,
    items,
    active,
    treeId,
    trigger,
    list,
    isExpanded,
    itemId: (key) => `${treeId}-${items.findIndex((item) => item.key === key)}`,
    toggle: () => (isOpen ? setIsOpen(false) : open()),
    search: (next) => {
      list.current?.scrollTo({ top: 0 });
      setQuery(next);
      expansion.setSearchClosed(new Set());
      setActiveKey(null);
    },
    toggleGroup,
    highlight: setActiveKey,
    choose,
    handleTriggerKeyDown: (event) => {
      if (isOpen || ARROW_OFFSETS[event.key] === undefined) return;
      event.preventDefault();
      open();
    },
    handleSearchKeyDown: (event) =>
      handlePickerKey(event, {
        items,
        active,
        isSearching,
        isExpanded,
        toggleGroup,
        choose,
        setActiveKey,
      }),
    handleBlur: (event) => closeOnLeave(event, () => setIsOpen(false)),
  };
}

// Focus that leaves the picker, by Tab or a click elsewhere, closes the panel.
function closeOnLeave(
  event: FocusEvent<HTMLDivElement>,
  close: () => void,
): void {
  const next = event.relatedTarget;
  if (next instanceof Node && event.currentTarget.contains(next)) return;
  close();
}

interface PickerKeyContext {
  readonly items: readonly PlanPickerItem[];
  readonly active: PlanPickerItem | null;
  readonly isSearching: boolean;
  readonly isExpanded: (groupKey: string) => boolean;
  readonly toggleGroup: (groupKey: string) => void;
  readonly choose: (choice: PlanModelChoice) => void;
  readonly setActiveKey: (key: string) => void;
}

// Right opens a closed tool or steps into an open one; Left closes an open
// tool or steps from a model back to its tool.
function moveInTree(key: string, context: PickerKeyContext): boolean {
  const { active } = context;
  if (!active) return false;
  if (active.kind === "model") {
    if (key !== "ArrowLeft") return false;
    context.setActiveKey(planGroupKey(active.groupKey));
    return true;
  }
  const isOpen = context.isExpanded(active.group.key);
  if (key === "ArrowRight" && !isOpen) context.toggleGroup(active.group.key);
  else if (key === "ArrowLeft" && isOpen) context.toggleGroup(active.group.key);
  else if (key === "ArrowRight") {
    const next = context.items[context.items.indexOf(active) + 1];
    if (next?.kind === "model") context.setActiveKey(next.key);
  }
  return true;
}

function handlePickerKey(
  event: KeyboardEvent<HTMLInputElement>,
  context: PickerKeyContext,
): void {
  const { active, items } = context;
  if (event.key === "Enter") {
    // Enter acts on the highlighted row and never submits the form.
    event.preventDefault();
    if (active?.kind === "model") context.choose(active.choice);
    else if (active) context.toggleGroup(active.group.key);
    return;
  }
  const isTreeKey = event.key === "ArrowRight" || event.key === "ArrowLeft";
  // While the search holds text, Left and Right keep moving the caret.
  if (isTreeKey && !context.isSearching) {
    if (moveInTree(event.key, context)) event.preventDefault();
    return;
  }
  const offset = ARROW_OFFSETS[event.key];
  if (offset === undefined || items.length === 0) return;
  event.preventDefault();
  const index = active ? items.indexOf(active) : -1;
  const next = (index + offset + items.length) % items.length;
  context.setActiveKey(items[next].key);
}
