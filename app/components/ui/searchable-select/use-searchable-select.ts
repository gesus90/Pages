import { useEffect, useId, useRef, useState } from "react";

import type { FocusEvent, KeyboardEvent, RefObject } from "react";

/** One choice of a searchable select. */
export interface SearchableSelectOption {
  readonly value: string;
  readonly label: string;
  /** Heading of the section above the option's group, such as where it runs. */
  readonly section?: string;
  /** Heading of the group the option is listed under, such as its provider. */
  readonly group?: string;
  /** Secondary text beside the label, such as the way of access. */
  readonly description?: string;
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

/** Visible options under one heading, in the order of the select's options. */
export interface SearchableSelectGroup {
  /** The shared heading; `undefined` for options without a group. */
  readonly label?: string;
  readonly options: readonly SearchableSelectOption[];
}

/** Visible groups under one section heading, in the order of their options. */
export interface SearchableSelectSection {
  /** The shared heading; `undefined` for options without a section. */
  readonly label?: string;
  readonly groups: readonly SearchableSelectGroup[];
}

/** State of one searchable select, shared by its trigger and its panel. */
export interface SearchableSelectState {
  readonly isOpen: boolean;
  readonly query: string;
  readonly pressedTags: readonly string[];
  readonly sections: readonly SearchableSelectSection[];
  /** The options of all sections and groups in the order they are listed. */
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

type OptionsByHeading = Map<string | undefined, SearchableSelectOption[]>;

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
  // A section heading, such as where models run, would match all its options.
  const text = [
    option.label,
    option.group,
    option.description,
    ...(option.keywords ?? []),
  ]
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
 * Collects options under their section and group headings.
 *
 * @param options - The options to list.
 * @returns One section per heading with one group per heading inside, each in
 * the order of its first option; options without a heading form a section or
 * group of their own.
 */
export function groupSearchableOptions(
  options: readonly SearchableSelectOption[],
): readonly SearchableSelectSection[] {
  const sections = new Map<string | undefined, OptionsByHeading>();
  for (const option of options) {
    const groups =
      sections.get(option.section) ??
      new Map<string | undefined, SearchableSelectOption[]>();
    const members = groups.get(option.group) ?? [];
    members.push(option);
    groups.set(option.group, members);
    sections.set(option.section, groups);
  }
  return [...sections].map(([label, groups]) => ({
    label,
    groups: [...groups].map(([group, members]) => ({
      label: group,
      options: members,
    })),
  }));
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
  // Arrow keys follow the listed order, which keeps each group together.
  const sections = groupSearchableOptions(
    filterSearchableOptions(input.options, query, pressedTags),
  );
  const visible = sections.flatMap((section) =>
    section.groups.flatMap((group) => group.options),
  );
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
    sections,
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
