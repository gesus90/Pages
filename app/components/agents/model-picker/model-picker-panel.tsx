import { Search } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";
import { focusOnMount } from "@/app/lib/focus-on-mount";

import { ModelGroupRows } from "./model-picker-rows";

import type { MouseEvent } from "react";
import type { ModelCatalogStatus } from "./use-model-catalog-refresh";
import type { ModelPickerState } from "./use-model-picker";

// Clicks inside the panel leave the focus in the search field, so the panel
// stays open and the keyboard highlight keeps working.
function keepSearchFocus(event: MouseEvent<HTMLDivElement>): void {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
}

function CatalogStatusLine({
  status,
}: {
  readonly status: ModelCatalogStatus;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (status !== "failed") return null;
  return (
    <p
      role="alert"
      className="border-b border-border px-3 py-1.5 text-xs text-warning"
    >
      {t("plans.modelPicker.catalog.failed")}
    </p>
  );
}

function PickerFooter({
  state,
  status,
}: {
  readonly state: ModelPickerState;
  readonly status: ModelCatalogStatus;
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
        {status === "refreshing"
          ? ` · ${t("plans.modelPicker.catalog.refreshing")}`
          : null}
      </p>
      <p aria-hidden="true">{hints.join(" · ")}</p>
    </footer>
  );
}

function EmptyState({
  state,
}: {
  readonly state: ModelPickerState;
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

function SearchField({
  state,
}: {
  readonly state: ModelPickerState;
}): React.ReactElement {
  const { t } = useTranslation();
  const { active } = state;
  return (
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
  );
}

/**
 * The open model choice: search field, tools as a tree of collapsible groups, and a count with the key hints.
 *
 * @remarks
 * The search covers every model, also those of closed tools, and opens
 * each tool with a match while it holds text. The list scrolls within the
 * height that fits the visible part of the page or dialog. A floating panel
 * lies above the page, so a canvas neither clips nor zooms it.
 */
export function ModelPickerPanel({
  state,
  value,
  status,
}: {
  readonly state: ModelPickerState;
  readonly value: string;
  readonly status: ModelCatalogStatus;
}): React.ReactElement {
  const { t } = useTranslation();
  const { panel, layout } = state;
  const rowCount = state.items.length;
  const isFloating = layout.anchor !== null;
  // The panel grows with a search or an opened tool; a scrolling dialog
  // follows, so the search field and footer stay in view.
  useEffect(() => {
    if (!isFloating) panel.current?.scrollIntoView({ block: "nearest" });
  }, [rowCount, isFloating, panel]);
  const content = (
    <div
      ref={panel}
      role="presentation"
      data-model-picker-panel={state.treeId}
      style={
        layout.anchor
          ? {
              left: layout.anchor.left,
              width: layout.anchor.width,
              top: layout.anchor.top,
              bottom: layout.anchor.bottom,
            }
          : // An inline panel is as wide as its rows need, also beside a narrow trigger.
            { minWidth: layout.minWidth ?? undefined }
      }
      className={cn(
        // A narrow panel leaves out the source badge; the source heading above names it.
        "@container z-50 overflow-hidden rounded-xl border border-border bg-surface text-left font-normal shadow-panel",
        isFloating ? "fixed" : "absolute inset-x-0",
        !isFloating &&
          (layout.placement === "above" ? "bottom-full mb-1" : "top-full mt-1"),
      )}
      onMouseDown={keepSearchFocus}
    >
      <SearchField state={state} />
      <CatalogStatusLine status={status} />
      <ScrollViewport
        ref={state.list}
        axis="vertical"
        containerStyle={{ maxHeight: layout.listHeight }}
        className="overflow-y-auto px-1.5 py-1"
      >
        <ul
          id={state.treeId}
          role="tree"
          aria-label={t("plans.modelPicker.tree")}
        >
          {state.groups.map((group) => (
            <ModelGroupRows
              key={group.key}
              group={group}
              state={state}
              value={value}
            />
          ))}
        </ul>
        {state.groups.length === 0 ? <EmptyState state={state} /> : null}
      </ScrollViewport>
      <PickerFooter state={state} status={status} />
    </div>
  );
  return isFloating ? createPortal(content, document.body) : content;
}
