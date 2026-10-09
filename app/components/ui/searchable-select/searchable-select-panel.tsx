import { Check } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";
import { focusOnMount } from "@/app/lib/focus-on-mount";

import type { MouseEvent } from "react";
import type {
  SearchableSelectFilter,
  SearchableSelectOption,
  SearchableSelectState,
} from "./use-searchable-select";

/** Texts of a searchable select; the caller translates them. */
export interface SearchableSelectTexts {
  /** Trigger text while nothing is chosen. */
  readonly placeholder: string;
  /** Marks a saved value that no option offers any more. */
  readonly unavailable: string;
  /** Name and placeholder of the search field in the panel. */
  readonly search: string;
  /** Shown when no option matches the search and prefilters. */
  readonly empty: string;
  readonly count: (count: number, total: number) => string;
}

// Scrolls a newly opened panel or highlighted option into view.
function revealElement(element: HTMLElement | null): void {
  element?.scrollIntoView({ block: "nearest" });
}

// Clicks inside the panel leave the focus in the search field, so the panel
// stays open and the keyboard highlight keeps working.
function keepSearchFocus(event: MouseEvent<HTMLDivElement>): void {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
}

function SearchableSelectItem({
  option,
  id,
  state,
  isSelected,
}: {
  readonly option: SearchableSelectOption;
  readonly id: string;
  readonly state: SearchableSelectState;
  readonly isSelected: boolean;
}): React.ReactElement {
  const isActive = option === state.active;
  return (
    <li
      ref={isActive ? revealElement : undefined}
      id={id}
      role="option"
      aria-selected={isSelected}
      aria-disabled={option.disabled === true}
      className={cn(
        "flex min-h-8 cursor-pointer items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground",
        isActive && "bg-muted",
        option.disabled === true && "cursor-not-allowed opacity-50",
      )}
      onClick={() => state.choose(option)}
      onMouseEnter={() => state.highlight(option)}
    >
      <span className="min-w-0 flex-1 wrap-anywhere">{option.label}</span>
      {isSelected ? (
        <Check
          className="mt-0.5 size-3.5 shrink-0 text-primary"
          aria-hidden="true"
        />
      ) : null}
    </li>
  );
}

function SearchableSelectFilters({
  filters,
  state,
}: {
  readonly filters: readonly SearchableSelectFilter[];
  readonly state: SearchableSelectState;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter) => {
        const isPressed = state.pressedTags.includes(filter.tag);
        return (
          <Button
            key={filter.tag}
            size="xs"
            variant="outline"
            aria-pressed={isPressed}
            className={cn(
              isPressed && "border-primary bg-primary/10 text-primary-text",
            )}
            onClick={() => state.toggleTag(filter.tag)}
          >
            {filter.label}
          </Button>
        );
      })}
    </div>
  );
}

/** The open panel: search field, prefilters, match count and listbox. */
export function SearchableSelectPanel({
  state,
  labelId,
  value,
  total,
  filters,
  texts,
}: {
  readonly state: SearchableSelectState;
  readonly labelId: string;
  readonly value: string;
  readonly total: number;
  readonly filters: readonly SearchableSelectFilter[];
  readonly texts: SearchableSelectTexts;
}): React.ReactElement {
  const activeIndex = state.active ? state.visible.indexOf(state.active) : -1;
  return (
    <div
      ref={revealElement}
      role="presentation"
      className="absolute inset-x-0 top-full z-50 mt-1 space-y-2 rounded-xl bg-surface p-2 shadow-panel"
      onMouseDown={keepSearchFocus}
    >
      <Input
        ref={focusOnMount}
        type="search"
        size="sm"
        value={state.query}
        maxLength={200}
        autoComplete="off"
        aria-label={texts.search}
        placeholder={texts.search}
        aria-autocomplete="list"
        aria-controls={state.listboxId}
        aria-activedescendant={
          activeIndex === -1 ? undefined : `${state.listboxId}-${activeIndex}`
        }
        onChange={(event) => state.search(event.currentTarget.value)}
        onKeyDown={state.handleSearchKeyDown}
      />
      {filters.length > 0 ? (
        <SearchableSelectFilters filters={filters} state={state} />
      ) : null}
      <p role="status" className="px-1 text-xs text-muted-foreground">
        {texts.count(state.visible.length, total)}
      </p>
      <ul
        id={state.listboxId}
        role="listbox"
        aria-labelledby={labelId}
        className="max-h-64 overflow-y-auto"
      >
        {state.visible.map((option, index) => (
          <SearchableSelectItem
            key={option.value}
            option={option}
            id={`${state.listboxId}-${index}`}
            state={state}
            isSelected={option.value === value}
          />
        ))}
      </ul>
      {state.visible.length === 0 ? (
        <p className="px-1 pb-1 text-xs text-muted-foreground">{texts.empty}</p>
      ) : null}
    </div>
  );
}
