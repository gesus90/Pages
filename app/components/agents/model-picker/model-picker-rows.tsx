import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { ToolMark } from "./tool-mark";
import { groupRowKey, modelRowKey } from "./use-model-picker";

import type { ModelChoice, ModelGroup, ModelSource } from "./model-catalog";
import type { ModelPickerState } from "./use-model-picker";

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

/** The green pill of a model the catalog states as free for exactly this access. */
export function FreeBadge(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-success/40 bg-success-subtle px-2 text-[11px] leading-none font-bold text-success">
      {t("plans.modelPicker.free")}
    </span>
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
  const isRefused = choice.refusal !== null;
  const name = [
    choice.label,
    choice.detail,
    choice.isFree ? t("plans.modelPicker.free") : null,
    choice.source,
    choice.refusal,
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
      aria-disabled={isRefused || undefined}
      aria-label={name}
      className={cn(
        ROW_CLASS,
        TEXT_COLUMN,
        "text-foreground",
        isSelected && "bg-primary-subtle",
        isActive && "bg-muted",
        isRefused && "cursor-not-allowed py-1 text-muted-foreground",
      )}
      onClick={() => state.choose(choice)}
      onMouseEnter={() => state.highlight(key)}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5">
        <span className="min-w-0 truncate">{choice.label}</span>
        {choice.detail === null ? null : (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {choice.detail}
          </span>
        )}
        {isRefused ? (
          <span className="basis-full text-xs text-warning">
            {choice.refusal}
          </span>
        ) : null}
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
  state,
  value,
}: {
  readonly source: ModelSource;
  readonly state: ModelPickerState;
  readonly value: string;
}): React.ReactElement {
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
          <span className="shrink-0">{source.label}</span>
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </li>
      )}
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

/**
 * One tool of the model choice: its header opens and closes the tool, its models follow while it is open.
 *
 * @remarks
 * The whole header is the switch. Its chevron and `aria-expanded` follow the
 * same state, and its accessible name gives tool, access and model count.
 * Header and model rows share the columns icon, name, extra and arrow or
 * check.
 */
export function ModelGroupRows({
  group,
  state,
  value,
}: {
  readonly group: ModelGroup;
  readonly state: ModelPickerState;
  readonly value: string;
}): React.ReactElement {
  const { t } = useTranslation();
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
          {group.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
          {group.context} · {group.count}
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
            <SourceRows
              key={source.key}
              source={source}
              state={state}
              value={value}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
