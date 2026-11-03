import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { findModelChoice, modelGroups } from "./model-picker/model-catalog";
import { ModelPickerPanel } from "./model-picker/model-picker-panel";
import { FreeBadge } from "./model-picker/model-picker-rows";
import { ToolMark } from "./model-picker/tool-mark";
import { useModelCatalogRefreshState } from "./model-picker/use-model-catalog-refresh";
import { useModelPicker } from "./model-picker/use-model-picker";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { ModelGroup } from "./model-picker/model-catalog";
import type {
  ModelPickerMode,
  ModelPickerState,
} from "./model-picker/use-model-picker";

interface ModelPickerProps {
  /** The selection key of the chosen model; empty while none is chosen. */
  readonly value: string;
  /** The models this place may offer, already limited to its target and consumer. */
  readonly models: readonly PageAgentModel[];
  /** The saved model ID, named while no listed model matches it. */
  readonly savedModel?: string;
  readonly disabled: boolean;
  readonly onChange: (id: string) => void;
  /** The field label; it defaults to "Model". */
  readonly label?: string;
  /** Keeps the label for assistive technology only, as in a compact card. */
  readonly isLabelHidden?: boolean;
  /** The text of the trigger while no model is chosen. */
  readonly placeholder?: string;
  /** Why a listed model cannot be chosen here; such a model stays listed, disabled, with the reason. */
  readonly refusalOf?: (model: PageAgentModel) => string | null;
  /** `floating` where the trigger sits on a zoomable canvas. */
  readonly mode?: ModelPickerMode;
  /** `compact` shows only mark and name in the trigger, for a small card. */
  readonly size?: "default" | "compact";
  readonly triggerClassName?: string;
}

// The trigger names the chosen model by its short name and, where its tool
// has several sources, by the source that tells equal names apart.
function TriggerValue(props: {
  readonly groups: readonly ModelGroup[];
  readonly value: string;
  readonly savedModel: string | undefined;
  readonly placeholder: string | undefined;
  readonly isCompact: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.value === "" && props.placeholder !== undefined)
    return (
      <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">
        {props.placeholder}
      </span>
    );
  const selected = findModelChoice(props.groups, props.value);
  if (!selected)
    return (
      <span className="min-w-0 flex-1 truncate text-warning">
        {props.savedModel ? `${props.savedModel} · ` : ""}
        {t("pageAgents.missingModel")}
      </span>
    );
  const { choice, group } = selected;
  // A source named like its tool, such as OpenCode's own models, adds nothing.
  const source = choice.source === group.label ? null : choice.source;
  const detail = [group.label, source, choice.detail]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <>
      <ToolMark mark={group.mark} />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="max-w-full min-w-0 shrink-0 truncate">
          {choice.label}
        </span>
        {choice.isFree ? <FreeBadge /> : null}
        {props.isCompact ? null : (
          <span className="ml-auto min-w-0 truncate text-xs font-normal text-plan-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </>
  );
}

function PickerTrigger(props: {
  readonly state: ModelPickerState;
  readonly labelId: string;
  readonly disabled: boolean;
  readonly isCompact: boolean;
  readonly className: string | undefined;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { state } = props;
  return (
    <button
      ref={state.trigger}
      type="button"
      role="combobox"
      aria-labelledby={`${props.labelId} ${props.labelId}-value`}
      aria-haspopup="tree"
      aria-expanded={state.isOpen}
      aria-controls={state.isOpen ? state.treeId : undefined}
      disabled={props.disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl bg-surface text-left font-medium text-foreground outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
        props.isCompact
          ? "min-h-8 gap-1.5 px-2 text-xs"
          : "min-h-10 px-3 py-1.5 text-sm shadow-field",
        props.className,
      )}
      onClick={state.toggle}
      onKeyDown={state.handleTriggerKeyDown}
    >
      <span
        id={`${props.labelId}-value`}
        className={cn(
          "flex min-w-0 flex-1 items-center",
          props.isCompact ? "gap-1.5" : "gap-2.5",
        )}
      >
        {props.children}
      </span>
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform",
          state.isOpen && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * Chooses a model from the shared catalog: the one model choice of Pages.
 *
 * @remarks
 * Pica, the plan editor and every other place that assigns a model use this
 * choice with the same projection ({@link modelGroups}), so equal models
 * look, group and search the same everywhere. Models are grouped by tool,
 * such as Claude Code or OpenCode, and OpenCode by the source it runs a
 * model with, such as OpenRouter. Rows show the short model name, because
 * the execution target stands once above the choice. The choice reports the
 * model's full selection key, never its display name, so connection,
 * provider and route stay exactly those of the listed model. Opening the
 * choice asks the page's refresh channel for a newer catalog.
 */
export function ModelPicker(props: ModelPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const catalog = useModelCatalogRefreshState();
  const groups = modelGroups(props.models, {
    translate: t,
    refusalOf: props.refusalOf,
  });
  const state = useModelPicker({
    value: props.value,
    groups,
    onChange: props.onChange,
    disabled: props.disabled,
    mode: props.mode ?? "inline",
    onOpen: catalog.refresh,
  });
  const labelId = `${useId()}-label`;
  const isCompact = props.size === "compact";
  return (
    <div
      className={cn("relative min-w-0", !props.isLabelHidden && "space-y-2")}
      onBlur={state.handleBlur}
    >
      <span
        id={labelId}
        className={
          props.isLabelHidden ? "sr-only" : "block text-sm font-medium"
        }
      >
        {props.label ?? t("pageAgents.model")}
      </span>
      <div className="relative">
        <PickerTrigger
          state={state}
          labelId={labelId}
          disabled={props.disabled}
          isCompact={isCompact}
          className={props.triggerClassName}
        >
          <TriggerValue
            groups={groups}
            value={props.value}
            savedModel={props.savedModel}
            placeholder={props.placeholder}
            isCompact={isCompact}
          />
        </PickerTrigger>
        {state.isOpen ? (
          <ModelPickerPanel
            state={state}
            value={props.value}
            status={catalog.status}
          />
        ) : null}
      </div>
    </div>
  );
}
