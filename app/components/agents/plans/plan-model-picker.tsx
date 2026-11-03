import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import {
  findPlanModelChoice,
  planModelGroups,
} from "./plan-model-picker/plan-model-catalog";
import { PlanModelPickerPanel } from "./plan-model-picker/plan-model-picker-panel";
import { PlanFreeBadge } from "./plan-model-picker/plan-model-picker-rows";
import { PlanToolMark } from "./plan-model-picker/plan-tool-mark";
import { usePlanModelPicker } from "./plan-model-picker/use-plan-model-picker";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { PlanModelPickerState } from "./plan-model-picker/use-plan-model-picker";
import type { PlanModelGroup } from "./plan-model-picker/plan-model-catalog";

interface PlanModelPickerProps {
  /** The selection key of the node's model. */
  readonly value: string;
  /** The models of the node's execution target. */
  readonly models: readonly PageAgentModel[];
  /** The saved model ID, named while no listed model matches it. */
  readonly savedModel?: string;
  readonly disabled: boolean;
  readonly onChange: (id: string) => void;
}

// The trigger names the chosen model by its short name and, where its tool
// has several sources, by the source that tells equal names apart.
function TriggerValue(props: {
  readonly groups: readonly PlanModelGroup[];
  readonly value: string;
  readonly savedModel: string | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const selected = findPlanModelChoice(props.groups, props.value);
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
      <PlanToolMark mark={group.mark} />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate">{choice.label}</span>
        {choice.isFree ? <PlanFreeBadge /> : null}
        <span className="ml-auto min-w-0 truncate text-xs font-normal text-plan-muted-foreground">
          {detail}
        </span>
      </span>
    </>
  );
}

function PickerTrigger(props: {
  readonly state: PlanModelPickerState;
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
      className="flex min-h-10 w-full items-center gap-2.5 rounded-xl bg-surface px-3 py-1.5 text-left text-sm font-medium text-foreground shadow-field outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
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
 * Chooses the model of a plan node from the tools of its execution target.
 *
 * @remarks
 * Models are grouped by tool, such as Claude Code or OpenCode, and OpenCode
 * by the source it runs a model with, such as OpenRouter. Rows show the short
 * model name, because the execution target stands once above the choice. The
 * choice reports the model's full selection key, never its display name, so
 * connection, provider and route stay exactly those of the listed model.
 */
export function PlanModelPicker(
  props: PlanModelPickerProps,
): React.ReactElement {
  const { t } = useTranslation();
  const groups = planModelGroups(props.models, t);
  const state = usePlanModelPicker({
    value: props.value,
    groups,
    onChange: props.onChange,
    disabled: props.disabled,
  });
  const labelId = `${useId()}-label`;
  return (
    <div className="relative min-w-0 space-y-2" onBlur={state.handleBlur}>
      <span id={labelId} className="block text-sm font-medium">
        {t("pageAgents.model")}
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
          />
        </PickerTrigger>
        {state.isOpen ? (
          <PlanModelPickerPanel state={state} value={props.value} />
        ) : null}
      </div>
    </div>
  );
}
