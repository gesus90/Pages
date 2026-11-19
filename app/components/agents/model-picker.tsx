import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Tooltip } from "@/app/components/ui/tooltip";
import { cn } from "@/app/lib/cn";

import { FreeBadge } from "./badges/free-badge";
import {
  ModelChoiceBadge,
  modelChoiceFieldClass,
  modelChoiceLabel,
} from "./badges/model-choice-badge";
import {
  findModelChoice,
  modelChoiceSource,
  modelGroups,
} from "./model-picker/model-catalog";
import {
  MODEL_BADGE_FIELD_ARROW_CLASS,
  MODEL_BADGE_FIELD_CLASS,
  MODEL_BADGE_FIELD_TEXT_CLASS,
  MODEL_FIELD_CLASS,
  MODEL_FIELD_LABEL_CLASS,
} from "./model-picker/model-field";
import { ModelPickerPanel } from "./model-picker/model-picker-panel";
import { modelRefusalText, usableModels } from "./model-picker/model-usability";
import { ToolMark } from "./model-picker/tool-mark";
import { useModelPicker } from "./model-picker/use-model-picker";

import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { AgentModelConsumer } from "@/definition/AgentModelConsumers";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { TFunction } from "i18next";
import type { ModelChoiceBadgeProps } from "./badges/model-choice-badge";
import type { ModelGroup } from "./model-picker/model-catalog";
import type {
  ModelPickerMode,
  ModelPickerState,
} from "./model-picker/use-model-picker";

interface ModelPickerProps {
  /** The selection key of the chosen model; empty while none is chosen. */
  readonly value: string;
  /**
   * The models this place may offer, limited only to its execution target and
   * access scope. The choice lists and searches only those of them that
   * `consumer` and `refusalOf` accept.
   */
  readonly models: readonly PageAgentModel[];
  /** Central capability rule; plans are the default consumer. */
  readonly consumer?: AgentModelConsumer;
  /** Current draft access level when choosing a model for an employee. */
  readonly employeeAccess?: AgentEmployeeAccess;
  /** The saved model ID, named while no listed model matches it, with the reason it cannot be used. */
  readonly savedModel?: string;
  /** The saved connection's provider when no catalog entry is available. */
  readonly savedProvider?: PageAgentModel["provider"] | null;
  readonly disabled: boolean;
  readonly onChange: (id: string) => void;
  /** The field label; it defaults to "Model". */
  readonly label?: string;
  /** Keeps the label for assistive technology only, as in a plan card. */
  readonly isLabelHidden?: boolean;
  /** The text of the trigger while no model is chosen. */
  readonly placeholder?: string;
  /**
   * Why this place cannot use a model beyond the central rule, such as a
   * connection that is off. Such a model is neither listed nor found by the
   * search; the reason names it only while it is the saved choice.
   */
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
  /**
   * How the closed trigger names the chosen model: `detail` with its tool,
   * source and ID (the default), `badge` as a model badge in the fixed field
   * of an agent node's footer.
   */
  readonly valueStyle?: ModelPickerValueStyle;
}

/** How the closed trigger of a model choice names its model. */
type ModelPickerValueStyle = "detail" | "badge";

// The trigger names the chosen model by its short name, its free mark and
// the tool it is listed under.
function TriggerValue(props: {
  readonly groups: readonly ModelGroup[];
  readonly value: string;
  readonly savedModel: string | undefined;
  readonly placeholder: string | undefined;
  readonly unusableReason: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.value === "" && props.placeholder !== undefined)
    return (
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {props.placeholder}
      </span>
    );
  const selected = findModelChoice(props.groups, props.value);
  if (!selected) {
    const reason = props.unusableReason ?? t("pageAgents.missingModel");
    return (
      <span
        className="min-w-0 flex-1 truncate text-warning"
        title={props.savedModel ? `${props.savedModel} · ${reason}` : reason}
      >
        {props.savedModel ? `${props.savedModel} · ` : ""}
        {reason}
      </span>
    );
  }
  const { choice, group } = selected;
  // A source named like its tool adds nothing.
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

function badgeChoice(
  selected: ReturnType<typeof findModelChoice>,
  props: ModelPickerProps,
  context: { readonly t: TFunction; readonly unusableReason: string | null },
): ModelChoiceBadgeProps | null {
  const { t } = context;
  if (selected)
    return {
      mark: selected.group.mark,
      name: selected.choice.label,
      tool: selected.group.label,
      source: modelChoiceSource(selected.choice.model, t),
    };
  if (
    props.value !== "" &&
    props.savedProvider === "openrouter" &&
    props.savedModel
  )
    return {
      mark: "openrouter",
      name: props.savedModel,
      tool: "OpenRouter",
      unavailableHint: context.unusableReason ?? t("pageAgents.missingModel"),
    };
  return null;
}

// The closed field still explains an unavailable model or an empty selection.
function BadgeTriggerValue(props: {
  readonly choice: ModelChoiceBadgeProps | null;
  readonly value: string;
  readonly savedModel: string | undefined;
  readonly placeholder: string | undefined;
  readonly unusableReason: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.value === "" && props.placeholder !== undefined)
    return (
      <span
        className={cn(MODEL_BADGE_FIELD_TEXT_CLASS, "text-muted-foreground")}
      >
        {props.placeholder}
      </span>
    );
  if (props.choice) return <ModelChoiceBadge {...props.choice} />;
  const reason = props.unusableReason ?? t("pageAgents.missingModel");
  return (
    <span
      className={cn(MODEL_BADGE_FIELD_TEXT_CLASS, "text-warning")}
      title={props.savedModel ? `${props.savedModel} · ${reason}` : reason}
    >
      {props.unusableReason === null
        ? t("pageAgents.modelMissingShort")
        : t("pageAgents.modelUnusableShort")}
    </span>
  );
}

function PickerTrigger(props: {
  readonly state: ModelPickerState;
  readonly labelId: string;
  readonly disabled: boolean;
  readonly valueStyle: ModelPickerValueStyle;
  readonly choice: ModelChoiceBadgeProps | null;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { state } = props;
  const isBadge = props.valueStyle === "badge";
  const trigger = (
    <button
      ref={state.trigger}
      type="button"
      role="combobox"
      aria-labelledby={`${props.labelId} ${props.labelId}-value`}
      aria-haspopup="tree"
      aria-expanded={state.isOpen}
      aria-controls={state.isOpen ? state.treeId : undefined}
      disabled={props.disabled}
      className={
        isBadge
          ? cn(
              MODEL_BADGE_FIELD_CLASS,
              modelChoiceFieldClass(props.choice?.mark ?? null),
            )
          : cn(
              MODEL_FIELD_CLASS,
              "flex items-center gap-2.5 text-left hover:bg-surface-hover",
            )
      }
      onClick={state.toggle}
      onKeyDown={state.handleTriggerKeyDown}
    >
      <span
        id={`${props.labelId}-value`}
        className={cn(
          "flex min-w-0 flex-1 items-center",
          !isBadge && "gap-2.5",
        )}
      >
        {props.children}
      </span>
      <ChevronDown
        className={cn(
          isBadge
            ? cn(MODEL_BADGE_FIELD_ARROW_CLASS, "text-muted-foreground")
            : "size-4 shrink-0 text-muted-foreground",
          "transition-transform",
          state.isOpen && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
  if (!isBadge) return trigger;
  const hint = props.choice ? modelChoiceLabel(props.choice) : null;
  return (
    <Tooltip
      content={<span className="wrap-anywhere">{hint}</span>}
      isDisabled={props.choice?.mark !== "openrouter" || state.isOpen}
      className="flex w-full"
      align="start"
      isFloating
    >
      {() => trigger}
    </Tooltip>
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
  const { listed, refusals } = usableModels(props.models, (model) =>
    modelRefusalText(props, model, t),
  );
  const groups = modelGroups(listed, {
    translate: t,
    selectedId: props.value,
  });
  // A saved model the place can no longer use is named at the field, never listed.
  const unusableReason = refusals.get(props.value) ?? null;
  const state = useModelPicker({
    value: props.value,
    groups,
    onChange: props.onChange,
    disabled: props.disabled,
    mode: props.mode ?? "inline",
  });
  const labelId = `${useId()}-label`;
  const valueStyle = props.valueStyle ?? "detail";
  const choice =
    valueStyle === "badge"
      ? badgeChoice(findModelChoice(groups, props.value), props, {
          t,
          unusableReason,
        })
      : null;
  const triggerValue = {
    groups,
    value: props.value,
    savedModel: props.savedModel,
    placeholder: props.placeholder,
    unusableReason,
  };
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
          valueStyle={valueStyle}
          choice={choice}
        >
          {valueStyle === "badge" ? (
            <BadgeTriggerValue {...triggerValue} choice={choice} />
          ) : (
            <TriggerValue {...triggerValue} />
          )}
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
