import { ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Tooltip } from "@/app/components/ui/tooltip";
import { cn } from "@/app/lib/cn";
import {
  consumerRunsProvider,
  modelConsumerRefusal,
} from "@/definition/AgentModelConsumers";

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
  savedSelection,
} from "./model-picker/model-catalog";
import {
  MODEL_BADGE_FIELD_ARROW_CLASS,
  MODEL_BADGE_FIELD_CLASS,
  MODEL_BADGE_FIELD_TEXT_CLASS,
  MODEL_FIELD_CLASS,
  MODEL_FIELD_LABEL_CLASS,
} from "./model-picker/model-field";
import { ModelPickerPanel } from "./model-picker/model-picker-panel";
import { ToolMark } from "./model-picker/tool-mark";
import { useCatalogStatuses } from "./model-picker/use-catalog-statuses";
import { useModelPicker } from "./model-picker/use-model-picker";

import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { AgentModelConsumer } from "@/definition/AgentModelConsumers";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { TFunction } from "i18next";
import type { ModelChoiceBadgeProps } from "./badges/model-choice-badge";
import type { ConnectionCatalogStatus } from "@/definition/AgentModelCatalogStatus";
import type { ModelChoice, ModelGroup } from "./model-picker/model-catalog";
import type { CatalogStatusState } from "./model-picker/use-catalog-statuses";
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
  /**
   * The catalog state of the connections this place may use, for a place
   * whose connections follow another account than the viewer's, such as the
   * chat of an agent. The panel then names exactly these connections, also
   * those without a model, instead of the viewer's own.
   */
  readonly connections?: readonly ConnectionCatalogStatus[];
  /** Called after an administrator reloaded a catalog, so the place can read its models anew. */
  readonly onCatalogReload?: () => void;
  /** `floating` where the trigger sits on a zoomable canvas. */
  readonly mode?: ModelPickerMode;
  /**
   * How the closed trigger names the chosen model: `detail` with its tool,
   * source and ID (the default), `badge` as a model badge in the fixed field
   * of an agent node's footer.
   */
  readonly valueStyle?: ModelPickerValueStyle;
  /**
   * Extra classes of an inline panel, for a place whose field is narrower than
   * the row it sits in: the chat dialog opens the panel across both of its
   * fields. A floating panel ignores them.
   */
  readonly panelClassName?: string;
}

/** How the closed trigger of a model choice names its model. */
type ModelPickerValueStyle = "detail" | "badge";

// "Werkzeug · Verbindung · Zugang"; a part that only repeats an earlier one,
// such as a connection named like its tool, adds nothing.
function fieldDetail(group: ModelGroup, choice: ModelChoice): string {
  const parts = [
    group.label,
    choice.connectionName,
    choice.access || (choice.source ?? ""),
    choice.detail ?? "",
  ];
  return parts
    .filter(
      (part, index) =>
        part !== "" &&
        !parts
          .slice(0, index)
          .some((earlier) => earlier.toLowerCase() === part.toLowerCase()),
    )
    .join(" · ");
}

// The trigger names the chosen model by its short name, its free mark and
// the tool, connection and access it is listed under.
function TriggerValue(props: {
  readonly groups: readonly ModelGroup[];
  readonly value: string;
  readonly savedId: string | null;
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
      <>
        <TriangleAlert
          className="size-4 shrink-0 text-warning"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-warning">
          {props.savedId ?? t("pageAgents.missingModel")}
        </span>
        <span className="shrink-0 text-xs text-warning">
          {t("plans.modelPicker.saved.unavailableShort")}
        </span>
      </>
    );
  const { choice, group } = selected;
  return (
    <>
      <ToolMark mark={group.mark} />
      <span className="min-w-0 shrink truncate">{choice.label}</span>
      <span className="ml-auto flex min-w-0 shrink-[2] items-center gap-2.5">
        {choice.isFree ? <FreeBadge /> : null}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {fieldDetail(group, choice)}
        </span>
      </span>
    </>
  );
}

function badgeChoice(
  selected: ReturnType<typeof findModelChoice>,
  props: ModelPickerProps,
  context: { readonly t: TFunction; readonly reason: string },
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
      unavailableHint: context.reason,
    };
  return null;
}

// The closed field still explains an unavailable model or an empty selection.
function BadgeTriggerValue(props: {
  readonly choice: ModelChoiceBadgeProps | null;
  readonly value: string;
  readonly savedId: string | null;
  readonly placeholder: string | undefined;
  readonly reason: string;
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
  return (
    <span
      className={cn(MODEL_BADGE_FIELD_TEXT_CLASS, "text-warning")}
      title={
        props.savedId ? `${props.savedId} · ${props.reason}` : props.reason
      }
    >
      {t("plans.modelPicker.saved.unavailableShort")}
    </span>
  );
}

function PickerTrigger(props: {
  readonly state: ModelPickerState;
  readonly labelId: string;
  readonly disabled: boolean;
  readonly valueStyle: ModelPickerValueStyle;
  readonly choice: ModelChoiceBadgeProps | null;
  /** A saved model that is no longer available: the field gets a 1 px warning ring. */
  readonly isUnavailable: boolean;
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
              props.isUnavailable && "ring-1 ring-warning",
            )
          : cn(
              MODEL_FIELD_CLASS,
              "flex items-center gap-2.5 text-left hover:bg-surface-hover",
              props.isUnavailable && "ring-1 ring-warning",
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

// The closed trigger's content: the badge form or the detail form.
function PickerTriggerValue(props: {
  readonly groups: readonly ModelGroup[];
  readonly value: string;
  readonly savedId: string | null;
  readonly placeholder: string | undefined;
  readonly valueStyle: ModelPickerValueStyle;
  readonly choice: ModelChoiceBadgeProps | null;
  readonly reason: string;
}): React.ReactElement {
  if (props.valueStyle === "badge")
    return (
      <BadgeTriggerValue
        choice={props.choice}
        value={props.value}
        savedId={props.savedId}
        placeholder={props.placeholder}
        reason={props.reason}
      />
    );
  return (
    <TriggerValue
      groups={props.groups}
      value={props.value}
      savedId={props.savedId}
      placeholder={props.placeholder}
    />
  );
}

// The note under the field when a saved model is no longer available.
function SavedModelNote(props: {
  readonly isSavedGone: boolean;
  readonly isDetail: boolean;
  readonly reason: string;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!props.isSavedGone || !props.isDetail) return null;
  return (
    <p className="mt-1.5 text-xs text-warning">
      {t("plans.modelPicker.saved.note", { reason: props.reason })}
    </p>
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
  const consumer = props.consumer ?? "plan";
  const { listed, refusals } = usableModels(props.models, (model) =>
    modelRefusalText(props, model, t),
  );
  const saved = savedSelection(props.value);
  const isSavedGone =
    props.value !== "" && !listed.some((model) => model.id === props.value);
  const [openCount, setOpenCount] = useState(0);
  const catalog = useCatalogStatuses({
    requestKey: catalogRequestKey(openCount, isSavedGone),
    savedConnectionId: saved?.connectionId ?? null,
    onReloaded: props.onCatalogReload,
  });
  const groups = modelGroups(listed, {
    translate: t,
    selectedId: props.value,
    statuses: placeStatuses(props, consumer, catalog),
  });
  const state = useModelPicker({
    value: props.value,
    groups,
    onChange: props.onChange,
    disabled: props.disabled,
    mode: props.mode ?? "inline",
  });
  useEffect(() => {
    if (state.isOpen) setOpenCount((count) => count + 1);
  }, [state.isOpen]);
  const labelId = `${useId()}-label`;
  const valueStyle = props.valueStyle ?? "detail";
  const savedId = savedModelId(props, saved);
  const reason = savedReason(refusals.get(props.value), catalog, t);
  const choice =
    valueStyle === "badge"
      ? badgeChoice(findModelChoice(groups, props.value), props, { t, reason })
      : null;
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
          isUnavailable={isSavedGone}
        >
          <PickerTriggerValue
            groups={groups}
            value={props.value}
            savedId={savedId}
            placeholder={props.placeholder}
            valueStyle={valueStyle}
            choice={choice}
            reason={reason}
          />
        </PickerTrigger>
        {state.isOpen ? (
          <ModelPickerPanel
            state={state}
            value={props.value}
            catalog={catalog}
            emptyLabel={props.emptyLabel}
            className={props.panelClassName}
            savedUnavailableId={isSavedGone ? (savedId ?? props.value) : null}
          />
        ) : null}
      </div>
      <SavedModelNote
        isSavedGone={isSavedGone}
        isDetail={valueStyle === "detail"}
        reason={reason}
      />
    </div>
  );
}

// The counter a newly opened or newly missing saved model advances, so the catalog reloads.
function catalogRequestKey(openCount: number, isSavedGone: boolean): number {
  return isSavedGone ? openCount + 1 : openCount;
}

// The model id the field keeps: the place's own saved name, else the saved key's model.
function savedModelId(
  props: ModelPickerProps,
  saved: ReturnType<typeof savedSelection>,
): string | null {
  return props.savedModel ?? saved?.model ?? null;
}

// A place with connections of its own names exactly those; a catalog read
// since then is newer than what the place was given.
function ownStatuses(
  own: readonly ConnectionCatalogStatus[],
  catalog: CatalogStatusState,
): readonly ConnectionCatalogStatus[] {
  const fresh = catalog.statuses?.connections ?? [];
  return own.map(
    (status) =>
      fresh.find((entry) => entry.connectionId === status.connectionId) ??
      status,
  );
}

// A place that lists models of a remote target never owns a local connection's state.
function placeStatuses(
  props: ModelPickerProps,
  consumer: AgentModelConsumer,
  catalog: CatalogStatusState,
): readonly ConnectionCatalogStatus[] | undefined {
  if (props.connections !== undefined)
    return ownStatuses(props.connections, catalog);
  if (props.models.some((model) => model.runnerRoute !== undefined))
    return undefined;
  return catalog.statuses?.connections.filter((status) =>
    consumerRunsProvider(consumer, status.provider),
  );
}

// Why a saved model is gone: the place's own refusal, otherwise what the
// connection's relation to this account says.
function savedReason(
  refusal: string | undefined,
  catalog: CatalogStatusState,
  t: TFunction,
): string {
  if (refusal !== undefined) return refusal;
  const relation = catalog.statuses?.savedConnection;
  if (relation === "missing")
    return t("plans.modelPicker.saved.reason.connectionGone");
  if (relation === "denied") return t("plans.modelPicker.saved.reason.denied");
  return t("plans.modelPicker.saved.reason.modelGone");
}

interface ModelUsageRule {
  readonly consumer?: AgentModelConsumer;
  readonly employeeAccess?: AgentEmployeeAccess;
  readonly refusalOf?: (model: PageAgentModel) => string | null;
}

interface UsableModels {
  readonly listed: readonly PageAgentModel[];
  readonly refusals: ReadonlyMap<string, string>;
}

function modelRefusalText(
  rule: ModelUsageRule,
  model: PageAgentModel,
  translate: TFunction,
): string | null {
  const refusal = modelConsumerRefusal(rule.consumer ?? "plan", model, {
    employeeAccess: rule.employeeAccess,
  });
  if (refusal === "zenToolsMissing")
    return translate("settings.agents.error.picaZenUnsupported");
  if (refusal !== null)
    return translate(`settings.agents.modelSelection.refusal.${refusal}`);
  return rule.refusalOf?.(model) ?? null;
}

function usableModels(
  models: readonly PageAgentModel[],
  refusalOf: (model: PageAgentModel) => string | null,
): UsableModels {
  const listed: PageAgentModel[] = [];
  const refusals = new Map<string, string>();
  for (const model of models) {
    const refusal = refusalOf(model);
    if (refusal === null) listed.push(model);
    else refusals.set(model.id, refusal);
  }
  return { listed, refusals };
}
