import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";
import {
  PLAN_JUMP_NAME_LENGTH,
  arePlanEntryInputsValid,
  arePlanEntryReturnsValid,
} from "@/definition/AgentPlanJump";

import { planNodeAccent } from "../plan-layout";
import { PlanNodeIcon } from "../plan-node-icon";
import {
  PlanEntryInputsEditor,
  PlanEntryReturnsEditor,
} from "./plan-entry-values";
import { PlanJumpDialogShell } from "./plan-jump-dialog-shell";

import type { AgentPlanEnd, AgentPlanStart } from "@/definition/AgentPlan";
import type {
  AgentPlanEntryInput,
  AgentPlanEntryReturn,
} from "@/definition/AgentPlanJump";
import type { PlanGraphActions } from "../use-plan-graph";

interface PlanEndpointDialogProps {
  readonly node: AgentPlanStart | AgentPlanEnd;
  readonly graph: PlanGraphActions;
  /** Whether the plan cannot be changed now: no edit right, or a command is on its way. */
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}

/** What the dialog of a start changes. */
interface StartDraft {
  readonly name: string;
  readonly callable: boolean;
  readonly inputs: readonly AgentPlanEntryInput[];
}

/** The settings of a start: an optional name, whether other plans may call it, and the inputs it accepts. */
function StartFields(props: {
  readonly draft: StartDraft;
  readonly isDisabled: boolean;
  readonly onChange: (draft: StartDraft) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const nameId = useId();
  const { draft } = props;
  return (
    <div className="space-y-4" data-plan-endpoint-fields="start">
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="block text-sm font-medium">
          {t("plans.entry.startName")}
        </label>
        <Input
          id={nameId}
          size="sm"
          value={draft.name}
          maxLength={PLAN_JUMP_NAME_LENGTH}
          autoComplete="off"
          disabled={props.isDisabled}
          placeholder={t("plans.nodeType.start")}
          onChange={(event) =>
            props.onChange({ ...draft, name: event.target.value })
          }
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.callable}
          disabled={props.isDisabled}
          onChange={(event) =>
            props.onChange({ ...draft, callable: event.target.checked })
          }
        />
        {t("plans.entry.callable")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t("plans.entry.callableHint")}
      </p>
      <PlanEntryInputsEditor
        entries={draft.inputs}
        isDisabled={props.isDisabled}
        onChange={(inputs) => props.onChange({ ...draft, inputs })}
      />
    </div>
  );
}

/** The start with the settings of the dialog; inputs and the switch are only stored when set. */
function appliedStart(
  start: AgentPlanStart,
  draft: StartDraft,
): AgentPlanStart {
  const name = draft.name.trim();
  return {
    ...start,
    name: name === "" ? undefined : name,
    callable: draft.callable ? true : undefined,
    inputs:
      draft.inputs.length > 0 || start.inputs !== undefined
        ? draft.inputs
        : undefined,
  };
}

/** The settings of a start behind its pencil. */
function StartDialog(
  props: PlanEndpointDialogProps & { readonly node: AgentPlanStart },
): React.ReactElement {
  const { t } = useTranslation();
  const { node } = props;
  const [draft, setDraft] = useState<StartDraft>({
    name: node.name ?? "",
    callable: node.callable === true,
    inputs: node.inputs ?? [],
  });
  const isValid = arePlanEntryInputsValid(draft.inputs);
  function apply(): void {
    if (props.isDisabled || !isValid) return;
    props.graph.replaceNode(appliedStart(node, draft));
    props.onClose();
  }
  return (
    <PlanJumpDialogShell
      name="start"
      title={
        <>
          <PlanNodeIcon
            type="start"
            className={cn("size-5 shrink-0", planNodeAccent("start"))}
          />
          {t("plans.entry.startTitle")}
        </>
      }
      description={t("plans.entry.startHint")}
      isDisabled={props.isDisabled}
      canApply={isValid}
      onApply={apply}
      onClose={props.onClose}
    >
      <StartFields
        draft={draft}
        isDisabled={props.isDisabled}
        onChange={setDraft}
      />
    </PlanJumpDialogShell>
  );
}

/** The settings of an end: the named, typed values it returns to the caller of the run. */
function EndDialog(
  props: PlanEndpointDialogProps & { readonly node: AgentPlanEnd },
): React.ReactElement {
  const { t } = useTranslation();
  const { node } = props;
  const [returns, setReturns] = useState<readonly AgentPlanEntryReturn[]>(
    node.returns ?? [],
  );
  const isValid = arePlanEntryReturnsValid(returns);
  function apply(): void {
    if (props.isDisabled || !isValid) return;
    props.graph.replaceNode({
      ...node,
      returns:
        returns.length > 0 || node.returns !== undefined ? returns : undefined,
    });
    props.onClose();
  }
  return (
    <PlanJumpDialogShell
      name="end"
      title={
        <>
          <PlanNodeIcon
            type="end"
            className={cn("size-5 shrink-0", planNodeAccent("end"))}
          />
          {t("plans.entry.endTitle")}
        </>
      }
      description={t("plans.entry.endHint")}
      isDisabled={props.isDisabled}
      canApply={isValid}
      onApply={apply}
      onClose={props.onClose}
    >
      <PlanEntryReturnsEditor
        entries={returns}
        isDisabled={props.isDisabled}
        onChange={setReturns}
      />
    </PlanJumpDialogShell>
  );
}

/**
 * The settings of a start or an end behind its pencil.
 * @remarks
 * A start can be released for calls by other plans and declares the inputs a
 * call hands over; the declarations are kept while the switch is off and only
 * hidden on the card. An end declares the named, typed values a called run
 * returns; each is bound at the end through a value input.
 */
export function PlanEndpointDialog(
  props: PlanEndpointDialogProps,
): React.ReactElement {
  return props.node.type === "start" ? (
    <StartDialog {...props} node={props.node} />
  ) : (
    <EndDialog {...props} node={props.node} />
  );
}
