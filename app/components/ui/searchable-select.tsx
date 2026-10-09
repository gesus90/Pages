import { ChevronDown } from "lucide-react";
import { useId } from "react";

import { SearchableSelectPanel } from "./searchable-select/searchable-select-panel";
import { useSearchableSelect } from "./searchable-select/use-searchable-select";

import type { SearchableSelectTexts } from "./searchable-select/searchable-select-panel";
import type {
  SearchableSelectFilter,
  SearchableSelectOption,
} from "./searchable-select/use-searchable-select";

interface SearchableSelectProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly SearchableSelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly texts: SearchableSelectTexts;
  /** Prefilter toggles shown below the search field. */
  readonly filters?: readonly SearchableSelectFilter[];
  readonly disabled?: boolean;
}

function triggerText(
  options: readonly SearchableSelectOption[],
  value: string,
  texts: SearchableSelectTexts,
): string {
  const selected = options.find((option) => option.value === value);
  if (selected) return selected.label;
  if (value === "") return texts.placeholder;
  return `${value} (${texts.unavailable})`;
}

/**
 * Renders a labeled select whose open panel starts with a search field.
 *
 * @remarks
 * The trigger is a select-only combobox; the open panel holds the search
 * field, optional prefilter toggles, a live match count and the listbox.
 * The panel stays inside the surrounding form or dialog instead of a portal,
 * so a modal dialog keeps the focus and pointer within reach. A saved value
 * without an option stays visible, marked as unavailable.
 */
export function SearchableSelect({
  id,
  label,
  value,
  options,
  onValueChange,
  texts,
  filters = [],
  disabled = false,
}: SearchableSelectProps): React.ReactElement {
  const state = useSearchableSelect({
    value,
    options,
    onValueChange,
    disabled,
  });
  const labelId = `${useId()}-label`;
  return (
    <div className="relative min-w-0 space-y-2" onBlur={state.handleBlur}>
      <label id={labelId} htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <button
        ref={state.trigger}
        id={id}
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={state.isOpen}
        aria-controls={state.isOpen ? state.listboxId : undefined}
        disabled={disabled}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-left text-xs font-medium text-foreground shadow-xs outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        onClick={state.toggle}
        onKeyDown={state.handleTriggerKeyDown}
      >
        <span className="min-w-0 flex-1 wrap-anywhere">
          {triggerText(options, value, texts)}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>
      {state.isOpen ? (
        <SearchableSelectPanel
          state={state}
          labelId={labelId}
          value={value}
          total={options.length}
          filters={filters}
          texts={texts}
        />
      ) : null}
    </div>
  );
}
