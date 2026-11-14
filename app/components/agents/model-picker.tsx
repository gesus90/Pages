import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { modelConsumerRefusal } from "@/definition/AgentModelConsumers";

import { cn } from "@/app/lib/cn";

import { findModelChoice, modelGroups } from "./model-picker/model-catalog";
import {
  MODEL_FIELD_CLASS,
  MODEL_FIELD_LABEL_CLASS,
} from "./model-picker/model-field";
import { ModelPickerPanel } from "./model-picker/model-picker-panel";
import { FreeBadge } from "./model-picker/model-picker-rows";
import { ToolMark } from "./model-picker/tool-mark";
import { useModelPicker } from "./model-picker/use-model-picker";

import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { AgentModelConsumer } from "@/definition/AgentModelConsumers";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { ModelGroup } from "./model-picker/model-catalog";
import type {
  ModelPickerMode,
  ModelPickerState,
} from "./model-picker/use-model-picker";

interface ModelPickerProps {
  /** The selection key of the chosen model; empty while none is chosen. */
  readonly value: string;
  /** The models this place may offer, limited only to its execution target and access scope. */
  readonly models: readonly PageAgentModel[];
  /** Central capability rule; plans are the default consumer. */
  readonly consumer?: AgentModelConsumer;
  /** Current draft access level when choosing a model for an employee. */
  readonly employeeAccess?: AgentEmployeeAccess;
  /** The saved model ID, named while no listed model matches it. */
  readonly savedModel?: string;
  readonly disabled: boolean;
  readonly onChange: (id: string) => void;
  /** The field label; it defaults to "Model". */
  readonly label?: string;
  /** Keeps the label for assistive technology only, as in a plan card. */
  readonly isLabelHidden?: boolean;
  /** The text of the trigger while no model is chosen. */
  readonly placeholder?: string;
  /** Why a listed model cannot be chosen here; such a model stays listed, disabled, with the reason. */
  readonly refusalOf?: (model: PageAgentModel) => string | null;
  /** What the open panel says when the place offers no model; a general note by default. */
  readonly emptyLabel?: string;
  /** `floating` where the trigger sits on a zoomable canvas. */
  readonly mode?: ModelPickerMode;
  /**
   * Whether the last server refresh of a catalog failed; only then the panel
   * warns. A listed model whose catalog failed warns as well.
   */
  readonly isCatalogFailed?: boolean;
}

// The trigger names the chosen model by its short name, its free mark and
// the tool it is listed under.
function TriggerValue(props: {
  readonly groups: readonly ModelGroup[];
  readonly value: string;
  readonly savedModel: string | undefined;
  readonly placeholder: string | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.value === "" && props.placeholder !== undefined)
    return (
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
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
      <span className="min-w-0 shrink truncate">{choice.label}</span>
      <span className="ml-auto flex min-w-0 shrink-[2] items-center gap-2.5">
        {choice.isFree ? <FreeBadge /> : null}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {detail}
        </span>
      </span>
    </>
  );
}

function PickerTrigger(props: {
  readonly state: ModelPickerState;
  readonly labelId: string;
  readonly disabled: boolean;
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
        MODEL_FIELD_CLASS,
        "flex items-center gap-2.5 text-left hover:bg-surface-hover",
      )}
      onClick={state.toggle}
      onKeyDown={state.handleTriggerKeyDown}
    >
      <span
        id={`${props.labelId}-value`}
        className="flex min-w-0 flex-1 items-center gap-2.5"
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
 * Pica, agent profiles, the plan editor, page agents and every other place
 * that assigns a model use this choice with the same projection
 * ({@link modelGroups}) and the same fixed measures, so equal models look,
 * group and search the same everywhere. Models are grouped by tool, such as
 * Claude Code, OpenCode or OpenRouter. Rows show the short model name,
 * because the execution target stands once above the choice. The choice
 * reports the model's full selection key, never its display name, so
 * connection, provider and route stay exactly those of the listed model. The
 * models come complete with the page; opening or using the choice loads
 * nothing.
 */
export function ModelPicker(props: ModelPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const groups = modelGroups(props.models, {
    translate: t,
    refusalOf: (model) => {
      const refusal = modelConsumerRefusal(props.consumer ?? "plan", model, {
        employeeAccess: props.employeeAccess,
      });
      if (refusal === "zenToolsMissing")
        return t("settings.agents.error.picaZenUnsupported");
      return refusal === null
        ? (props.refusalOf?.(model) ?? null)
        : t(`settings.agents.modelSelection.refusal.${refusal}`);
    },
    selectedId: props.value,
  });
  const state = useModelPicker({
    value: props.value,
    groups,
    onChange: props.onChange,
    disabled: props.disabled,
    mode: props.mode ?? "inline",
  });
  const labelId = `${useId()}-label`;
  return (
    <div className="relative min-w-0" onBlur={state.handleBlur}>
      <span
        id={labelId}
        className={props.isLabelHidden ? "sr-only" : MODEL_FIELD_LABEL_CLASS}
      >
        {props.label ?? t("pageAgents.model")}
      </span>
      <div className="relative">
        <PickerTrigger
          state={state}
          labelId={labelId}
          disabled={props.disabled}
        >
          <TriggerValue
            groups={groups}
            value={props.value}
            savedModel={props.savedModel}
            placeholder={props.placeholder}
          />
        </PickerTrigger>
        {state.isOpen ? (
          <ModelPickerPanel
            state={state}
            value={props.value}
            emptyLabel={props.emptyLabel}
            isCatalogFailed={
              props.isCatalogFailed === true ||
              props.models.some((model) => model.isCatalogFailed === true)
            }
          />
        ) : null}
      </div>
    </div>
  );
}
