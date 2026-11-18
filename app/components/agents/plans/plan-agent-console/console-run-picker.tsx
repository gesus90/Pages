import { Check, ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { formatRunTime } from "./console-time";
import { RUN_ROW_HEIGHT, useRunPicker } from "./use-run-picker";

import type { RunPicker } from "./use-run-picker";
import type { AgentPlanRunSummary } from "@/definition/AgentPlan";

interface ConsoleRunPickerProps {
  readonly runs: readonly AgentPlanRunSummary[];
  readonly selectedId: string;
  readonly ariaLabel: string;
  readonly onSelect: (id: string) => void;
}

function RunOptions({
  picker,
  runs,
  selectedId,
  listId,
}: {
  readonly picker: RunPicker;
  readonly runs: readonly AgentPlanRunSummary[];
  readonly selectedId: string;
  readonly listId: string;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { rows } = picker;
  return (
    <div className="relative" style={{ height: rows.totalHeight }}>
      {runs.slice(rows.start, rows.end).map((entry, offset) => {
        const index = rows.start + offset;
        return (
          <div
            key={entry.id}
            id={`${listId}-${String(index)}`}
            role="option"
            aria-selected={entry.id === selectedId}
            aria-posinset={index + 1}
            aria-setsize={runs.length}
            className={cn(
              "absolute inset-x-0 flex h-8 cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 text-xs font-medium text-foreground",
              index === picker.activeIndex && "bg-muted",
            )}
            style={{ top: index * RUN_ROW_HEIGHT }}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => picker.choose(index)}
          >
            <span className="truncate">
              {runLabel(entry, { t, language: i18n.language })}
            </span>
            {entry.id === selectedId ? (
              <Check
                className="size-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The run as the choice names it, such as `18.11.2026, 14:23 · Läuft`: the app language sets date and clock, a 24-hour clock. */
function runLabel(
  entry: AgentPlanRunSummary,
  texts: {
    readonly t: ReturnType<typeof useTranslation>["t"];
    readonly language: string;
  },
): string {
  const { t, language } = texts;
  const started = formatRunTime(entry.startedAt, language) ?? entry.startedAt;
  const manual = entry.manualInputAt
    ? ` · ${t("plans.console.manualInput")}`
    : "";
  return `${started} · ${t(`plans.status.${entry.status}`)}${manual}`;
}

/**
 * Chooses a run of the console's history in a list that draws only its visible runs.
 *
 * @remarks
 * Looks and works like the select it replaces; a plan with a thousand runs
 * still draws only the rows in view.
 */
export function ConsoleRunPicker({
  runs,
  selectedId,
  ariaLabel,
  onSelect,
}: ConsoleRunPickerProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const picker = useRunPicker({ runs, selectedId, onSelect });
  const selected = runs.find((entry) => entry.id === selectedId);
  return (
    <div
      ref={picker.rootRef}
      className="relative min-w-0 flex-1 sm:w-64 sm:flex-none"
    >
      <button
        ref={picker.triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={picker.isOpen}
        aria-controls={picker.isOpen ? listId : undefined}
        className="inline-flex h-10 w-full max-w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-foreground outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary"
        onClick={picker.toggle}
        onKeyDown={picker.onTriggerKeyDown}
      >
        <span className="truncate">
          {selected ? runLabel(selected, { t, language: i18n.language }) : ""}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>
      {picker.isOpen ? (
        <div className="absolute right-0 z-50 mt-1.5 w-full min-w-40 rounded-xl bg-surface p-1 shadow-panel">
          <div
            ref={picker.listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-activedescendant={`${listId}-${String(picker.activeIndex)}`}
            className="overflow-y-auto outline-none"
            style={{ height: picker.listHeight }}
            onScroll={picker.rows.onScroll}
            onKeyDown={picker.onListKeyDown}
          >
            <RunOptions
              picker={picker}
              runs={runs}
              selectedId={selectedId}
              listId={listId}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
