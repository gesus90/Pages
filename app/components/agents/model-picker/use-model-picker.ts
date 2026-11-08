import { useEffect, useId, useRef, useState } from "react";

import { visibleBand } from "@/app/components/ui/searchable-select/use-searchable-select";

import { filterModelGroups, findModelChoice } from "./model-catalog";

import type { FocusEvent, KeyboardEvent, RefObject } from "react";
import type { ModelChoice, ModelGroup } from "./model-catalog";

/** A row the keyboard can reach: a tool's header or one of its models. */
export type ModelPickerItem =
  | {
      readonly kind: "group";
      readonly key: string;
      readonly group: ModelGroup;
    }
  | {
      readonly kind: "model";
      readonly key: string;
      readonly groupKey: string;
      readonly choice: ModelChoice;
    };

/**
 * Where the open panel lies and how high its list may grow.
 *
 * @remarks
 * `inline` panels hang below or above their trigger inside the page or
 * dialog. A `floating` panel, used where the trigger sits on a zoomable
 * canvas, lies above the page at the trigger's place in the viewport.
 */
export interface ModelPickerLayout {
  readonly placement: "below" | "above";
  readonly listHeight: number;
  /** Least width of an inline panel: room for its rows, but never past the window's right edge. */
  readonly minWidth: number | null;
  /** Viewport position of a floating panel; `null` for an inline one. */
  readonly anchor: {
    readonly left: number;
    readonly width: number;
    readonly top?: number;
    readonly bottom?: number;
  } | null;
}

/** How the panel is attached to its trigger. */
export type ModelPickerMode = "inline" | "floating";

/** State of the model choice, shared by its trigger and its panel. */
export interface ModelPickerState {
  readonly isOpen: boolean;
  readonly query: string;
  readonly isSearching: boolean;
  readonly layout: ModelPickerLayout;
  /** The groups and models that match the search, collapsed groups included. */
  readonly groups: readonly ModelGroup[];
  /** The rows in the order they are listed: headers and models of open groups. */
  readonly items: readonly ModelPickerItem[];
  readonly active: ModelPickerItem | null;
  readonly treeId: string;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  /** The open panel, which may lie outside the picker's own element. */
  readonly panel: RefObject<HTMLDivElement | null>;
  /** The scrolling list, which a new search shows from its first match. */
  readonly list: RefObject<HTMLElement | null>;
  readonly isExpanded: (groupKey: string) => boolean;
  /** The element ID of a listed row, for `aria-activedescendant`. */
  readonly itemId: (key: string) => string;
  readonly toggle: () => void;
  readonly search: (query: string) => void;
  readonly toggleGroup: (groupKey: string) => void;
  readonly highlight: (key: string) => void;
  readonly choose: (choice: ModelChoice) => void;
  readonly handleTriggerKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void;
  readonly handleSearchKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
  ) => void;
  readonly handleBlur: (event: FocusEvent<HTMLElement>) => void;
}

/** Room of the search field and the panel's padding around the list. */
const PANEL_CHROME = 64;
// Below the minimum a surrounding dialog scrolls to show the whole panel;
// the floor is the least a list keeps where no side has the minimum.
const LIST_HEIGHT = { floor: 160, min: 320, max: 480 } as const;
/** A panel is never narrower than this beside a small trigger, where the window has the room. */
const FLOATING_WIDTH = 352;
const VIEWPORT_MARGIN = 8;
const PANEL_GAP = 4;
/** The attribute that ties a panel to its picker, also where the panel lies outside it. */
const PANEL_ATTRIBUTE = "data-model-picker-panel";
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
export function groupRowKey(key: string): string {
  return `group:${key}`;
}

/**
 * The row key of a model.
 *
 * @param id - The model's selection key.
 * @returns A key no header row shares.
 */
export function modelRowKey(id: string): string {
  return `model:${id}`;
}

// Where neither side has the minimum, as in a small window with a large
// font, the list takes the larger side, so the whole panel stays visible.
function listHeight(below: number, above: number): ModelPickerLayout {
  const isAbove =
    below < LIST_HEIGHT.min && (above >= LIST_HEIGHT.min || above > below);
  const room = isAbove ? above : below;
  const minimum = room >= LIST_HEIGHT.min ? LIST_HEIGHT.min : LIST_HEIGHT.floor;
  return {
    placement: isAbove ? "above" : "below",
    listHeight: Math.min(LIST_HEIGHT.max, Math.max(minimum, room)),
    minWidth: null,
    anchor: null,
  };
}

// The right edge an inline panel may reach: the window's, or that of a
// container that clips its overflow, such as a card.
function visibleRight(element: HTMLElement): number {
  let right = window.innerWidth;
  for (let parent = element.parentElement; parent;) {
    if (getComputedStyle(parent).overflowX !== "visible")
      right = Math.min(right, parent.getBoundingClientRect().right);
    parent = parent.parentElement;
  }
  return right;
}

// The search field grows with the page's font size.
function panelChrome(): number {
  const fontSize = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return PANEL_CHROME * (Number.isFinite(fontSize) ? fontSize / 16 : 1);
}

// Opens above the trigger only where the whole panel fits there: content
// above a scrolling dialog's top cannot be scrolled to, content below can.
function measureLayout(
  trigger: HTMLElement | null,
  mode: ModelPickerMode,
): ModelPickerLayout {
  if (!trigger)
    return {
      placement: "below",
      listHeight: LIST_HEIGHT.max,
      minWidth: null,
      anchor: null,
    };
  const bounds = trigger.getBoundingClientRect();
  const chrome = panelChrome();
  if (mode === "inline") {
    const band = visibleBand(trigger);
    return {
      ...listHeight(
        band.bottom - bounds.bottom - chrome,
        bounds.top - band.top - chrome,
      ),
      minWidth: Math.max(
        bounds.width,
        Math.min(
          FLOATING_WIDTH,
          visibleRight(trigger) - bounds.left - VIEWPORT_MARGIN,
        ),
      ),
    };
  }
  const layout = listHeight(
    window.innerHeight - bounds.bottom - chrome - VIEWPORT_MARGIN,
    bounds.top - chrome - VIEWPORT_MARGIN,
  );
  const width = Math.min(
    Math.max(bounds.width, FLOATING_WIDTH),
    window.innerWidth - 2 * VIEWPORT_MARGIN,
  );
  const left = Math.min(
    Math.max(bounds.left, VIEWPORT_MARGIN),
    window.innerWidth - width - VIEWPORT_MARGIN,
  );
  return {
    ...layout,
    anchor:
      layout.placement === "below"
        ? { left, width, top: bounds.bottom + PANEL_GAP }
        : { left, width, bottom: window.innerHeight - bounds.top + PANEL_GAP },
  };
}

function listedItems(
  groups: readonly ModelGroup[],
  isExpanded: (groupKey: string) => boolean,
): ModelPickerItem[] {
  return groups.flatMap((group): ModelPickerItem[] => [
    { kind: "group", key: groupRowKey(group.key), group },
    ...(isExpanded(group.key)
      ? group.sources.flatMap((source) =>
          source.choices.map((choice): ModelPickerItem => ({
            kind: "model",
            key: modelRowKey(choice.model.id),
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

/**
 * Closes a floating panel once its trigger moves: a canvas that pans or
 * zooms, or a page that scrolls or resizes, would leave the panel behind.
 */
function useFloatingClose(input: {
  readonly isOpen: boolean;
  readonly mode: ModelPickerMode;
  readonly panel: RefObject<HTMLDivElement | null>;
  readonly close: () => void;
}): void {
  const { isOpen, mode, panel, close } = input;
  useEffect(() => {
    if (!isOpen || mode !== "floating") return undefined;
    function closeOutside(event: Event): void {
      const target = event.target;
      if (target instanceof Node && panel.current?.contains(target)) return;
      close();
    }
    window.addEventListener("wheel", closeOutside, true);
    window.addEventListener("scroll", closeOutside, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("wheel", closeOutside, true);
      window.removeEventListener("scroll", closeOutside, true);
      window.removeEventListener("resize", close);
    };
  }, [isOpen, mode, panel, close]);
}

/** The open and collapsed groups: the person's own choice, and a separate one while searching. */
function useGroupExpansion(input: {
  readonly groups: readonly ModelGroup[];
  readonly value: string;
}): {
  readonly expanded: ReadonlySet<string>;
  readonly setExpanded: (keys: ReadonlySet<string>) => void;
  readonly searchClosed: ReadonlySet<string>;
  readonly setSearchClosed: (keys: ReadonlySet<string>) => void;
} {
  // The tool of the saved model starts open; the person decides the rest.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const selected = findModelChoice(input.groups, input.value);
    return new Set(selected ? [selected.group.key] : []);
  });
  // A search opens every matching group; closing one there leaves the
  // person's own choice untouched, so clearing the search restores it.
  const [searchClosed, setSearchClosed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  return { expanded, setExpanded, searchClosed, setSearchClosed };
}

/** Input of {@link useModelPicker}. */
export interface ModelPickerInput {
  readonly value: string;
  readonly groups: readonly ModelGroup[];
  readonly onChange: (id: string) => void;
  readonly disabled: boolean;
  readonly mode: ModelPickerMode;
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
 * A model the place refuses can be highlighted, to read its reason, but not
 * chosen.
 */
export function useModelPicker(input: ModelPickerInput): ModelPickerState {
  const [isOpenState, setIsOpen] = useState(false);
  const isOpen = isOpenState && !input.disabled;
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<ModelPickerLayout>(() =>
    measureLayout(null, input.mode),
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const expansion = useGroupExpansion(input);
  const treeId = `${useId()}-tree`;
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const isSearching = query.trim() !== "";
  const groups = filterModelGroups(input.groups, query);
  const { value } = input;
  const isExpanded = (groupKey: string): boolean =>
    isGroupExpanded(groupKey, isSearching, expansion);
  const items = listedItems(groups, isExpanded);
  const active = activeItem({ items, activeKey, isSearching, value });
  const closeRef = useRef(() => {
    setIsOpen(false);
    trigger.current?.focus();
  });
  useEscapeClose(isOpen, closeRef.current);
  const dismissRef = useRef(() => setIsOpen(false));
  useFloatingClose({
    isOpen,
    mode: input.mode,
    panel,
    close: dismissRef.current,
  });

  function open(): void {
    const selected = findModelChoice(input.groups, input.value);
    if (selected && !expansion.expanded.has(selected.group.key))
      expansion.setExpanded(toggled(expansion.expanded, selected.group.key));
    setQuery("");
    expansion.setSearchClosed(new Set());
    setActiveKey(selected ? modelRowKey(input.value) : null);
    setLayout(measureLayout(trigger.current, input.mode));
    setIsOpen(true);
  }

  function toggleGroup(groupKey: string): void {
    if (isSearching)
      expansion.setSearchClosed(toggled(expansion.searchClosed, groupKey));
    else expansion.setExpanded(toggled(expansion.expanded, groupKey));
    setActiveKey(groupRowKey(groupKey));
  }

  function choose(choice: ModelChoice): void {
    if (choice.refusal !== null) return;
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
    panel,
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
    handleBlur: (event) =>
      closeOnLeave(event, { treeId, close: () => setIsOpen(false) }),
  };
}

function isGroupExpanded(
  groupKey: string,
  isSearching: boolean,
  expansion: ReturnType<typeof useGroupExpansion>,
): boolean {
  return isSearching
    ? !expansion.searchClosed.has(groupKey)
    : expansion.expanded.has(groupKey);
}

// A search starts at its first match, so Enter chooses it and the list shows
// the matches from the top; otherwise the saved model is highlighted.
function activeItem(input: {
  readonly items: readonly ModelPickerItem[];
  readonly activeKey: string | null;
  readonly isSearching: boolean;
  readonly value: string;
}): ModelPickerItem | null {
  const { items } = input;
  return (
    items.find((item) => item.key === input.activeKey) ??
    (input.isSearching
      ? items.find((item) => item.kind === "model")
      : items.find((item) => item.key === modelRowKey(input.value))) ??
    items.at(0) ??
    null
  );
}

// Focus that leaves the picker, by Tab or a click elsewhere, closes the
// panel. A floating panel lies outside the picker's element but belongs to
// it; its search field takes the focus before React binds the panel's ref,
// so the panel is recognised by its attribute.
function closeOnLeave(
  event: FocusEvent<HTMLElement>,
  input: { readonly treeId: string; readonly close: () => void },
): void {
  const next = event.relatedTarget;
  if (next instanceof Node && event.currentTarget.contains(next)) return;
  if (
    next instanceof Element &&
    next.closest(`[${PANEL_ATTRIBUTE}="${input.treeId}"]`)
  )
    return;
  input.close();
}

interface PickerKeyContext {
  readonly items: readonly ModelPickerItem[];
  readonly active: ModelPickerItem | null;
  readonly isSearching: boolean;
  readonly isExpanded: (groupKey: string) => boolean;
  readonly toggleGroup: (groupKey: string) => void;
  readonly choose: (choice: ModelChoice) => void;
  readonly setActiveKey: (key: string) => void;
}

// Right opens a closed tool or steps into an open one; Left closes an open
// tool or steps from a model back to its tool.
function moveInTree(key: string, context: PickerKeyContext): boolean {
  const { active } = context;
  if (!active) return false;
  if (active.kind === "model") {
    if (key !== "ArrowLeft") return false;
    context.setActiveKey(groupRowKey(active.groupKey));
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
