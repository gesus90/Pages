import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";
import { focusOnMount } from "@/app/lib/focus-on-mount";

import { MODEL_FIELD_CLASS } from "./model-field";
import { ModelGroupRows } from "./model-picker-rows";

import type { MouseEvent } from "react";
import type { CatalogStatusState } from "./use-catalog-statuses";
import type { ModelPickerState } from "./use-model-picker";

// Clicks inside the panel leave the focus in the search field, so the panel
// stays open and the keyboard highlight keeps working.
function keepSearchFocus(event: MouseEvent<HTMLDivElement>): void {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
}

function useHitAnnouncement(state: ModelPickerState): string {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState("");
  const message =
    state.matchCount === 0
      ? t("plans.modelPicker.noHits")
      : t("plans.modelPicker.hits", { count: state.matchCount });
  const { isSearching } = state;
  // A screen reader hears the count once the person stops typing.
  useEffect(() => {
    if (!isSearching) {
      setAnnouncement("");
      return undefined;
    }
    const timer = window.setTimeout(() => setAnnouncement(message), 300);
    return () => window.clearTimeout(timer);
  }, [isSearching, message]);
  return announcement;
}

function EmptyState({
  state,
  emptyLabel,
}: {
  readonly state: ModelPickerState;
  readonly emptyLabel: string | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  if (state.isSearching)
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t("plans.modelPicker.noMatch", { query: state.query.trim() })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("plans.modelPicker.noMatchHint")}
        </p>
      </div>
    );
  return (
    <div className="px-3 py-6 text-center">
      <p className="text-sm text-muted-foreground">
        {emptyLabel ?? t("plans.modelPicker.noModels")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("plans.modelPicker.noModelsHintBefore")}
        <Link
          to="/agents"
          className="text-primary underline underline-offset-2"
        >
          {t("plans.modelPicker.noModelsLink")}
        </Link>
        {t("plans.modelPicker.noModelsHintAfter")}
      </p>
    </div>
  );
}

// Three rows of the size of a model row, so nothing jumps when the list comes.
function LoadingRows(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t("plans.modelPicker.loading")}
      className="px-1.5 py-1"
    >
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex min-h-9 items-center gap-2.5 px-2.5 pointer-coarse:min-h-11"
        >
          <span className="size-5 shrink-0 rounded-[5px] bg-muted" />
          <span className="h-3.5 w-[90px] rounded bg-muted" />
          <span className="ml-auto h-3 w-[70px] rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function SavedUnavailableRow({
  savedId,
}: {
  readonly savedId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className="mx-2 mt-2 rounded-lg bg-warning-subtle px-2.5 py-1 text-xs leading-4 text-warning">
      {t("plans.modelPicker.saved.row", { id: savedId })}
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
  const announcement = useHitAnnouncement(state);
  return (
    <div className="relative border-b border-border p-2">
      <Search
        className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={focusOnMount}
        type="search"
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
        className={cn(
          MODEL_FIELD_CLASS,
          "pl-9 placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none",
          state.query === "" ? "pr-3" : "pr-28",
        )}
        onChange={(event) => state.search(event.currentTarget.value)}
        onKeyDown={state.handleSearchKeyDown}
      />
      {state.query === "" ? null : (
        <div className="absolute top-1/2 right-5 flex -translate-y-1/2 items-center gap-1.5">
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {state.matchCount === 0
              ? t("plans.modelPicker.noHits")
              : t("plans.modelPicker.hits", { count: state.matchCount })}
          </span>
          <button
            type="button"
            aria-label={t("plans.modelPicker.clearSearch")}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            onClick={state.clearSearch}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

/**
 * The open model choice: search field and tools as a tree of collapsible groups.
 * @remarks
 * The search covers every model, also those of closed tools, and opens
 * each tool with a match while it holds text. The list scrolls within the
 * height that fits the visible part of the page or dialog. A floating panel
 * lies above the page, so a canvas neither clips nor zooms it. The keys
 * work as before without a footer naming them. Each connection explains its
 * own missing models inside its tool; the panel has no collective warning.
 */
export function ModelPickerPanel({
  state,
  value,
  catalog,
  emptyLabel,
  className,
  savedUnavailableId,
}: {
  readonly state: ModelPickerState;
  readonly value: string;
  readonly catalog: CatalogStatusState;
  /** The place's own note for an empty catalog; a search without match keeps its own. */
  readonly emptyLabel?: string;
  /** Extra classes of an inline panel; a floating panel ignores them. */
  readonly className?: string;
  /** The saved model ID that is no longer available, named at the top of the panel; `null` otherwise. */
  readonly savedUnavailableId: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { panel, layout } = state;
  const rowCount = state.items.length;
  const isFloating = layout.anchor !== null;
  const isLoading = catalog.isLoading && state.groups.length === 0;
  // The panel grows with a search or an opened tool; a scrolling dialog
  // follows, so the search field stays in view.
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
        "z-50 overflow-hidden rounded-xl border border-border bg-surface text-left font-normal shadow-panel",
        isFloating ? "fixed" : "absolute inset-x-0",
        !isFloating &&
          (layout.placement === "above" ? "bottom-full mb-1" : "top-full mt-1"),
        !isFloating && className,
      )}
      onMouseDown={keepSearchFocus}
    >
      <SearchField state={state} />
      {savedUnavailableId === null ? null : (
        <SavedUnavailableRow savedId={savedUnavailableId} />
      )}
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
              context={{ state, catalog, value }}
            />
          ))}
        </ul>
        {isLoading ? <LoadingRows /> : null}
        {!isLoading && state.matchCount === 0 ? (
          <EmptyState state={state} emptyLabel={emptyLabel} />
        ) : null}
      </ScrollViewport>
    </div>
  );
  return isFloating ? createPortal(content, document.body) : content;
}
