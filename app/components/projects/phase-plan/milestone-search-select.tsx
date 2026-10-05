import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Input } from "@/app/components/ui/input";
import { focusOnMount } from "@/app/lib/focus-on-mount";

import type { ChangeEvent, KeyboardEvent } from "react";

interface SearchOption {
  readonly id: string;
  readonly name: string;
}

interface MilestoneSearchSelectProps<Option extends SearchOption> {
  readonly options: readonly Option[];
  readonly selectedId: string | null;
  readonly onSelect: (option: Option) => void;
  readonly choosePlaceholder: string;
  readonly searchPlaceholder: string;
}

/** Renders a searchable milestone picker for dependency targets. */
export function MilestoneSearchSelect<Option extends SearchOption>({
  options,
  selectedId,
  onSelect,
  choosePlaceholder,
  searchPlaceholder,
}: MilestoneSearchSelectProps<Option>): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const matches = options.filter((option) =>
    option.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function handleOpen(): void {
    setQuery("");
    setIsOpen(true);
  }

  function handleClose(): void {
    setIsOpen(false);
  }

  function handleSelect(option: Option): void {
    onSelect(option);
    setIsOpen(false);
  }

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>): void {
    setQuery(event.currentTarget.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      // Only the picker closes; the panel around it stays open.
      event.stopPropagation();
      handleClose();
    }
  }

  return (
    <div className="relative" onKeyDown={handleKeyDown} role="presentation">
      <button
        type="button"
        className="inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-card px-2.5 text-xs font-medium text-foreground shadow-xs outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary"
        onClick={handleOpen}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selected ? selected.name : choosePlaceholder}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <>
          <button
            type="button"
            aria-label={choosePlaceholder}
            className="fixed inset-0 z-[70] cursor-default"
            onClick={handleClose}
          />
          <div className="absolute inset-x-0 top-full z-[71] mt-1 rounded-xl border border-border/60 bg-surface p-1 shadow-panel">
            <Input
              value={query}
              maxLength={100}
              ref={focusOnMount}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={handleQueryChange}
            />
            <ul className="mt-1 max-h-48 overflow-y-auto">
              {matches.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="flex min-h-8 w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-foreground outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => handleSelect(option)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.name}
                    </span>
                  </button>
                </li>
              ))}
              {matches.length === 0 ? (
                <li className="px-2.5 py-2 text-xs text-muted-foreground">
                  {searchPlaceholder}
                </li>
              ) : null}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
