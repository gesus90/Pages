import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { FreeBadge } from "../badges/free-badge";
import { highlightParts } from "./model-catalog";
import { ModelSourceStatus } from "./model-source-status";
import { ToolMark } from "./tool-mark";
import { groupRowKey, modelRowKey } from "./use-model-picker";

import type { TFunction } from "i18next";
import type { ModelChoice, ModelGroup, ModelSource } from "./model-catalog";
import type { CatalogStatusState } from "./use-catalog-statuses";
import type { ModelPickerState } from "./use-model-picker";

/** What the rows of the open choice need beyond the picker's own state. */
export interface ModelRowContext {
  readonly state: ModelPickerState;
  readonly catalog: CatalogStatusState;
  /** The key of the chosen model. */
  readonly value: string;
}

// Every row is 36 px high with 14 px text; on a touch screen only the row
// grows, never the text.
const ROW_CLASS =
  "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm pointer-coarse:min-h-11";

// Model rows start in the text column of the headers: padding, icon and gap.
const TEXT_COLUMN = "pl-10";

// Scrolls the highlighted row into view inside the list.
function revealRow(element: HTMLElement | null): void {
  element?.scrollIntoView({ block: "nearest" });
}

/**
 * A text with the stretches the search words match set apart.
 * @remarks
 * A match is `primary` at 26 % opacity behind the text with a 3 px radius and
 * weight 700, the same in the model name, the tool and the connection.
 */
function Highlighted({
  text,
  terms,
}: {
  readonly text: string;
  readonly terms: readonly string[];
}): React.ReactElement {
  return (
    <>
      {highlightParts(text, terms).map((part, index) =>
        part.isMatch ? (
          <mark
            key={index}
            className="rounded-[3px] bg-primary/26 font-bold text-inherit"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function ModelRow({
  choice,
  state,
  isSelected,
}: {
  readonly choice: ModelChoice;
  readonly state: ModelPickerState;
  readonly isSelected: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const key = modelRowKey(choice.model.id);
  const isActive = state.active?.key === key;
  const name = [
    choice.label,
    choice.detail,
    choice.isFree ? t("plans.modelPicker.free") : null,
    choice.source,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <li
      ref={isActive ? revealRow : undefined}
      id={state.itemId(key)}
      role="treeitem"
      aria-level={2}
      aria-selected={isSelected}
      aria-label={name}
      className={cn(
        ROW_CLASS,
        TEXT_COLUMN,
        "text-foreground",
        isSelected && "bg-primary-subtle",
        isActive && "bg-muted",
      )}
      onClick={() => state.choose(choice)}
      onMouseEnter={() => state.highlight(key)}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5">
        <span className="min-w-0 truncate">
          <Highlighted text={choice.label} terms={state.terms} />
        </span>
        {choice.detail === null ? null : (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {choice.detail}
          </span>
        )}
      </span>
      {choice.isFree ? <FreeBadge /> : null}
      <Check
        className={cn(
          "size-4 shrink-0 text-primary",
          !isSelected && "invisible",
        )}
        aria-hidden="true"
      />
    </li>
  );
}

function SourceRows({
  source,
  context,
}: {
  readonly source: ModelSource;
  readonly context: ModelRowContext;
}): React.ReactElement {
  const { state, catalog, value } = context;
  return (
    <>
      {source.label === null ? null : (
        <li
          role="presentation"
          className={cn(
            "flex items-center gap-2.5 pt-2 pr-2.5 pb-1 text-xs font-semibold text-muted-foreground",
            TEXT_COLUMN,
          )}
        >
          <span className="shrink-0">
            <Highlighted text={source.label} terms={state.terms} />
          </span>
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </li>
      )}
      <ModelSourceStatus
        source={source}
        catalog={catalog}
        isSearching={state.isSearching}
      />
      {source.choices.map((choice) => (
        <ModelRow
          key={choice.model.id}
          choice={choice}
          state={state}
          isSelected={choice.model.id === value}
        />
      ))}
    </>
  );
}

// "Zugang · Anzahl" ("API-Key · 0 von 6" where the connection offers models
// but none fits the place); a search names its matches instead.
function groupCountText(
  group: ModelGroup,
  isSearching: boolean,
  t: TFunction,
): string {
  if (isSearching) return t("plans.modelPicker.hits", { count: group.count });
  if (group.count === 0 && group.catalogTotal > 0)
    return `${group.context} · ${t("plans.modelPicker.countOf", {
      shown: group.count,
      total: group.catalogTotal,
    })}`;
  return `${group.context} · ${group.count}`;
}

/**
 * One tool of the model choice: its header opens and closes the tool, its models follow while it is open.
 * @remarks
 * The whole header is the switch. Its chevron and `aria-expanded` follow the
 * same state, and its accessible name gives tool, access and model count.
 * Header and model rows share the columns icon, name, extra and arrow or
 * check.
 */
export function ModelGroupRows({
  group,
  context,
}: {
  readonly group: ModelGroup;
  readonly context: ModelRowContext;
}): React.ReactElement {
  const { t } = useTranslation();
  const { state } = context;
  const key = groupRowKey(group.key);
  const isActive = state.active?.key === key;
  const isExpanded = state.isExpanded(group.key);
  return (
    <li
      id={state.itemId(key)}
      role="treeitem"
      aria-level={1}
      aria-expanded={isExpanded}
      aria-label={t("plans.modelPicker.groupLabel", {
        tool: group.label,
        context: group.context,
        count: group.count,
      })}
    >
      <div
        ref={isActive ? revealRow : undefined}
        className={cn(ROW_CLASS, isActive && "bg-muted")}
        onClick={() => state.toggleGroup(group.key)}
        onMouseEnter={() => state.highlight(key)}
      >
        <ToolMark mark={group.mark} />
        <span className="max-w-[60%] min-w-0 shrink-0 truncate font-bold text-foreground">
          <Highlighted text={group.label} terms={state.terms} />
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
          {groupCountText(group, state.isSearching, t)}
        </span>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            isExpanded && "rotate-90",
          )}
          aria-hidden="true"
        />
      </div>
      {isExpanded ? (
        <ul role="group">
          {group.sources.map((source) => (
            <SourceRows key={source.key} source={source} context={context} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
