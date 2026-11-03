import { Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { PlanToolMark } from "./plan-tool-mark";
import { planGroupKey, planModelKey } from "./use-plan-model-picker";

import type {
  PlanModelChoice,
  PlanModelGroup,
  PlanModelSource,
} from "./plan-model-catalog";
import type { PlanModelPickerState } from "./use-plan-model-picker";

// Model rows start in the text column of the headers: padding, mark and gap.
const TEXT_COLUMN = "pl-[2.625rem]";

// Scrolls the highlighted row into view inside the list.
function revealRow(element: HTMLElement | null): void {
  element?.scrollIntoView({ block: "nearest" });
}

/** The small green mark of a model the catalog states as free for exactly this access. */
export function PlanFreeBadge(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-4 shrink-0 items-center rounded bg-success-subtle px-1.5 text-[0.6875rem] leading-none font-semibold text-success ring-1 ring-success/25">
      {t("plans.modelPicker.free")}
    </span>
  );
}

function SourceBadge({
  source,
}: {
  readonly source: string;
}): React.ReactElement {
  return (
    <span className="inline-flex h-4 max-w-32 shrink-0 items-center truncate rounded bg-surface px-1.5 text-[0.6875rem] leading-none font-medium text-plan-muted-foreground ring-1 ring-border">
      {source}
    </span>
  );
}

function ModelRow({
  choice,
  state,
  isSelected,
}: {
  readonly choice: PlanModelChoice;
  readonly state: PlanModelPickerState;
  readonly isSelected: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const key = planModelKey(choice.model.id);
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
        "flex min-h-8 cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2.5 text-sm text-foreground",
        TEXT_COLUMN,
        isSelected && "bg-primary-subtle font-medium",
        isActive && "bg-muted",
      )}
      onClick={() => state.choose(choice)}
      onMouseEnter={() => state.highlight(key)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate">{choice.label}</span>
        {choice.isFree ? <PlanFreeBadge /> : null}
        {choice.detail === null ? null : (
          <span className="min-w-0 truncate text-xs text-plan-muted-foreground">
            {choice.detail}
          </span>
        )}
      </span>
      {choice.source === null ? null : <SourceBadge source={choice.source} />}
      <Check
        className={cn(
          "size-3.5 shrink-0 text-primary",
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
  readonly source: PlanModelSource;
  readonly state: PlanModelPickerState;
  readonly value: string;
}): React.ReactElement {
  return (
    <>
      {source.label === null ? null : (
        <li
          role="presentation"
          className={cn(
            "flex items-center gap-2 pt-2 pr-2.5 pb-1 text-[0.6875rem] font-semibold tracking-wide text-plan-muted-foreground uppercase",
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
 */
export function PlanModelGroupRows({
  group,
  state,
  value,
}: {
  readonly group: PlanModelGroup;
  readonly state: PlanModelPickerState;
  readonly value: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const key = planGroupKey(group.key);
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
      className="border-b border-border last:border-b-0"
    >
      <div
        ref={isActive ? revealRow : undefined}
        className={cn(
          "my-0.5 flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm",
          isExpanded && "bg-surface-hover",
          isActive && "bg-muted",
        )}
        onClick={() => state.toggleGroup(group.key)}
        onMouseEnter={() => state.highlight(key)}
      >
        <PlanToolMark mark={group.mark} />
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
          {group.label}
        </span>
        <span className="min-w-0 truncate text-xs text-plan-muted-foreground">
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
        <ul role="group" className="pb-1">
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
