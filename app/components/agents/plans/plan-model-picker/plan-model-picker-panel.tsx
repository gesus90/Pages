import { Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";
import { focusOnMount } from "@/app/lib/focus-on-mount";

import { PlanModelGroupRows } from "./plan-model-picker-rows";

import type { MouseEvent } from "react";
import type { PlanModelPickerState } from "./use-plan-model-picker";

// Clicks inside the panel leave the focus in the search field, so the panel
// stays open and the keyboard highlight keeps working.
function keepSearchFocus(event: MouseEvent<HTMLDivElement>): void {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
}

function PickerFooter({
  state,
}: {
  readonly state: PlanModelPickerState;
}): React.ReactElement {
  const { t } = useTranslation();
  const count = state.groups.reduce((sum, group) => sum + group.count, 0);
  const models = state.isSearching
    ? t("plans.modelPicker.matchCount", { count })
    : t("plans.modelPicker.modelCount", { count });
  const hints = [
    t("plans.modelPicker.hintMove"),
    state.isSearching ? null : t("plans.modelPicker.hintGroup"),
    t("plans.modelPicker.hintChoose"),
    t("plans.modelPicker.hintClose"),
  ].filter((hint) => hint !== null);
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <p role="status">
        {models} ·{" "}
        {t("plans.modelPicker.toolCount", { count: state.groups.length })}
      </p>
      <p aria-hidden="true">{hints.join(" · ")}</p>
    </footer>
  );
}

function EmptyState({
  state,
}: {
  readonly state: PlanModelPickerState;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
      {state.isSearching
        ? t("plans.modelPicker.noMatch", { query: state.query.trim() })
        : t("plans.modelPicker.noModels")}
    </p>
  );
}

/**
 * The open model choice: search field, tools as a tree of collapsible groups, and a count with the key hints.
 *
 * @remarks
 * The search covers every model, also those of closed tools, and opens
 * each tool with a match while it holds text. The list scrolls within the
 * height that fits the visible part of the page or dialog.
 */
export function PlanModelPickerPanel({
  state,
  value,
}: {
  readonly state: PlanModelPickerState;
  readonly value: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { active } = state;
  const panel = useRef<HTMLDivElement>(null);
  const rowCount = state.items.length;
  // The panel grows with a search or an opened tool; a scrolling dialog
  // follows, so the search field and footer stay in view.
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest" });
  }, [rowCount]);
  return (
    <div
      ref={panel}
      role="presentation"
      className={cn(
        "absolute inset-x-0 z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-panel",
        state.layout.placement === "above"
          ? "bottom-full mb-1"
          : "top-full mt-1",
      )}
      onMouseDown={keepSearchFocus}
    >
      <div className="relative border-b border-border p-2">
        <Search
          className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={focusOnMount}
          type="search"
          size="sm"
          role="combobox"
          aria-expanded={true}
          aria-autocomplete="list"
          aria-controls={state.treeId}
          aria-activedescendant={active ? state.itemId(active.key) : undefined}
          aria-label={t("plans.modelPicker.search")}
          placeholder={t("plans.modelPicker.searchPlaceholder")}
          value={state.query}
          maxLength={200}
          autoComplete="off"
          className="h-9 pl-8 text-sm shadow-none xl:pl-8 xl:text-sm"
          onChange={(event) => state.search(event.currentTarget.value)}
          onKeyDown={state.handleSearchKeyDown}
        />
      </div>
      <ScrollViewport
        ref={state.list}
        axis="vertical"
        containerStyle={{ maxHeight: state.layout.listHeight }}
        className="overflow-y-auto px-1.5 py-1"
      >
        <ul
          id={state.treeId}
          role="tree"
          aria-label={t("plans.modelPicker.tree")}
        >
          {state.groups.map((group) => (
            <PlanModelGroupRows
              key={group.key}
              group={group}
              state={state}
              value={value}
            />
          ))}
        </ul>
        {state.groups.length === 0 ? <EmptyState state={state} /> : null}
      </ScrollViewport>
      <PickerFooter state={state} />
    </div>
  );
}
