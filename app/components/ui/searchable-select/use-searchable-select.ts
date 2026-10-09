import { useEffect, useId, useRef, useState } from "react";

import type { FocusEvent, KeyboardEvent, RefObject } from "react";

/** One choice of a searchable select. */
export interface SearchableSelectOption {
  readonly value: string;
  readonly label: string;
  /** Further words the search matches, such as a provider's full name. */
  readonly keywords?: readonly string[];
  /** Properties the panel's prefilters select by, such as `free`. */
  readonly tags?: readonly string[];
  readonly disabled?: boolean;
}

/** A prefilter toggle in the open panel that keeps only options with its tag. */
export interface SearchableSelectFilter {
  readonly tag: string;
  readonly label: string;
}

/** State of one searchable select, shared by its trigger and its panel. */
export interface SearchableSelectState {
  readonly isOpen: boolean;
  readonly query: string;
  readonly pressedTags: readonly string[];
  readonly visible: readonly SearchableSelectOption[];
  readonly active: SearchableSelectOption | null;
  readonly listboxId: string;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly toggle: () => void;
  readonly search: (query: string) => void;
  readonly toggleTag: (tag: string) => void;
  readonly highlight: (option: SearchableSelectOption) => void;
  readonly choose: (option: SearchableSelectOption) => void;
  readonly handleTriggerKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void;
  readonly handleSearchKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
  ) => void;
  readonly handleBlur: (event: FocusEvent<HTMLDivElement>) => void;
}

const ARROW_OFFSETS: Partial<Record<string, number>> = {
  ArrowDown: 1,
  ArrowUp: -1,
};

function isEnabled(option: SearchableSelectOption): boolean {
  return option.disabled !== true;
}

function matches(
  option: SearchableSelectOption,
  terms: readonly string[],
  tags: readonly string[],
): boolean {
  const text = [option.label, ...(option.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return (
    terms.every((term) => text.includes(term)) &&
    tags.every((tag) => option.tags?.includes(tag) === true)
  );
}

/**
 * Keeps the options that contain every word of the query and every pressed tag.
 *
 * @param options - All options of the select.
 * @param query - The typed search, matched without regard to case.
 * @param tags - The pressed prefilter tags.
 * @returns The matching options in their original order.
 */
export function filterSearchableOptions(
  options: readonly SearchableSelectOption[],
  query: string,
  tags: readonly string[],
): readonly SearchableSelectOption[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((option) => matches(option, terms, tags));
}

/**
 * Holds the open state, search, prefilters and keyboard highlight of a select.
 *
 * @remarks
 * Focus stays in the search field while the listbox is open, as in the
 * combobox pattern of the ARIA Authoring Practices. Arrow keys move the
 * highlight over enabled options, Enter chooses it, and Escape closes only
 * the panel, also inside a dialog.
 */
export function useSearchableSelect(input: {
  readonly value: string;
  readonly options: readonly SearchableSelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly disabled: boolean;
}): SearchableSelectState {
  const [isExpanded, setIsOpen] = useState(false);
  // A disabled select, for example while its form saves, shows no panel.
  const isOpen = isExpanded && !input.disabled;
  const [query, setQuery] = useState("");
  const [pressedTags, setPressedTags] = useState<readonly string[]>([]);
  const [activeValue, setActiveValue] = useState(input.value);
  const listboxId = `${useId()}-listbox`;
  const trigger = useRef<HTMLButtonElement>(null);
  const visible = filterSearchableOptions(input.options, query, pressedTags);
  const enabled = visible.filter(isEnabled);
  const active =
    enabled.find((option) => option.value === activeValue) ??
    enabled.at(0) ??
    null;

  useEffect(() => {
    if (!isOpen) return undefined;
    // The window hears the key before a Radix dialog, which leaves an event
    // with a prevented default alone, so Escape closes only this panel.
    function closeOnEscape(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsOpen(false);
      trigger.current?.focus();
    }
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [isOpen]);

  function open(): void {
    setQuery("");
    setActiveValue(input.value);
    setIsOpen(true);
  }

  function toggle(): void {
    if (isOpen) setIsOpen(false);
    else open();
  }

  function choose(option: SearchableSelectOption): void {
    if (!isEnabled(option)) return;
    input.onValueChange(option.value);
    setIsOpen(false);
    trigger.current?.focus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      // Enter chooses the highlighted option and never submits the form.
      event.preventDefault();
      if (active) choose(active);
      return;
    }
    const offset = ARROW_OFFSETS[event.key];
    if (offset === undefined || !active) return;
    event.preventDefault();
    const index = enabled.indexOf(active) + offset + enabled.length;
    setActiveValue(enabled[index % enabled.length].value);
  }

  return {
    isOpen,
    query,
    pressedTags,
    visible,
    active,
    listboxId,
    trigger,
    toggle,
    search: setQuery,
    toggleTag: (tag) =>
      setPressedTags((current) =>
        current.includes(tag)
          ? current.filter((entry) => entry !== tag)
          : [...current, tag],
      ),
    highlight: (option) => {
      if (isEnabled(option)) setActiveValue(option.value);
    },
    choose,
    handleTriggerKeyDown: (event) => {
      if (isOpen || ARROW_OFFSETS[event.key] === undefined) return;
      event.preventDefault();
      open();
    },
    handleSearchKeyDown,
    handleBlur: (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setIsOpen(false);
    },
  };
}
