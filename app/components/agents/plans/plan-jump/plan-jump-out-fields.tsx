import { TriangleAlert } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { PLAN_JUMP_MAX_MINUTES } from "@/definition/AgentPlanJump";

import { PLAN_ENTRY_VALUE_TYPES } from "./plan-entry-values";
import { currentCallEntry, planJumpTargetProblem } from "./plan-jump-model";
import {
  planEntryOptions,
  planTargetOptions,
} from "./plan-jump-target-options";

import type { AgentParameterType } from "@/definition/AgentParameters";
import type {
  AgentPlanCallTarget,
  AgentPlanJumpOut,
  AgentPlanJumpWait,
  AgentPlanJumpWorkspace,
} from "@/definition/AgentPlanJump";
import type { PlanJumpForm } from "./use-plan-jump-form";

const WAITS: readonly AgentPlanJumpWait[] = [
  "continue",
  "completion",
  "signal",
];

interface PlanJumpOutFieldsProps {
  readonly form: PlanJumpForm;
  /** The plans the person may call; `undefined` while they are not known. */
  readonly targets: readonly AgentPlanCallTarget[] | undefined;
  readonly isDisabled: boolean;
}

/** A labelled field of the dialog. */
function Field(props: {
  readonly id: string;
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="block text-sm font-medium">
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

/** The names of declared values in one line, or that there are none. */
function useNames(names: readonly string[]): string {
  const { t } = useTranslation();
  return names.length > 0 ? names.join(", ") : t("plans.jump.none");
}

/** What the stored target takes and returns, so the ports on the card are explained. */
function InterfaceSummary(props: {
  readonly call: AgentPlanJumpOut;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { call } = props;
  const inputs = useNames(call.inputs.map((input) => input.name));
  const returns = useNames(call.returns.map((entry) => entry.name));
  if (!call.target) return null;
  return (
    <p className="text-xs text-muted-foreground" data-plan-jump-interface="">
      {t("plans.jump.interface", { inputs, returns })}
    </p>
  );
}

/** The finding about the stored target, with the way to take over the interface it has now. */
function TargetProblem(
  props: PlanJumpOutFieldsProps,
): React.ReactElement | null {
  const { t } = useTranslation();
  const { call } = props.form.state;
  const problem = planJumpTargetProblem(call, props.targets);
  if (!problem) return null;
  const current = currentCallEntry(call, props.targets);
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
    >
      <p className="flex items-start gap-1.5 font-medium">
        <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>{t(`plans.jump.problem.${problem}`)}</span>
      </p>
      {problem === "jumpInterface" && current ? (
        <Button
          size="xs"
          variant="outline"
          className="self-start"
          disabled={props.isDisabled}
          onClick={() => props.form.chooseEntry(current.target, current.entry)}
        >
          {t("plans.jump.takeInterface")}
        </Button>
      ) : null}
    </div>
  );
}

/** The plan and the entry of the call, chosen only among what the person may call. */
function TargetFields(props: PlanJumpOutFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const planId = useId();
  const entryId = useId();
  const { form, targets = [] } = props;
  const { call } = form.state;
  const chosen = targets.find((entry) => entry.planId === call.target?.planId);
  return (
    <>
      <Field id={planId} label={t("plans.jump.targetPlan")}>
        <Select
          id={planId}
          value={call.target?.planId ?? ""}
          disabled={props.isDisabled || targets.length === 0}
          options={planTargetOptions(call, targets, t)}
          className="w-full"
          onValueChange={(next) => {
            const target = targets.find((entry) => entry.planId === next);
            const entry = target?.entries.find(
              (item) => !item.hasReturnConflict,
            );
            if (target && entry) form.chooseEntry(target, entry);
          }}
        />
        {targets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.jump.noTargets")}
          </p>
        ) : null}
      </Field>
      <Field id={entryId} label={t("plans.jump.targetEntry")}>
        <Select
          id={entryId}
          value={call.target?.entryNodeId ?? ""}
          disabled={props.isDisabled || !chosen}
          options={planEntryOptions(call, targets, t)}
          className="w-full"
          onValueChange={(next) => {
            const entry = chosen?.entries.find(
              (item) => item.entryNodeId === next,
            );
            if (chosen && entry) form.chooseEntry(chosen, entry);
          }}
        />
        <InterfaceSummary call={call} />
      </Field>
      <TargetProblem {...props} />
    </>
  );
}

/** The wait, its signal name and payload type, and its time limit. */
function WaitFields(props: PlanJumpOutFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const waitId = useId();
  const signalId = useId();
  const payloadId = useId();
  const { form } = props;
  const { call } = form.state;
  return (
    <>
      <Field id={waitId} label={t("plans.jump.wait.label")}>
        <Select<AgentPlanJumpWait>
          id={waitId}
          value={call.wait}
          disabled={props.isDisabled}
          className="w-full"
          options={WAITS.map((wait) => ({
            value: wait,
            label: t(`plans.jump.wait.${wait}`),
            description: t(`plans.jump.wait.${wait}Hint`),
          }))}
          onValueChange={form.setWait}
        />
      </Field>
      {call.wait === "signal" ? (
        <>
          <Field id={signalId} label={t("plans.jump.signalName")}>
            <Input
              id={signalId}
              size="sm"
              value={call.signalName ?? ""}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              disabled={props.isDisabled}
              aria-invalid={form.issues.signalName}
              className="font-mono"
              onChange={(event) =>
                form.changeCall({ signalName: event.target.value })
              }
            />
            {form.issues.signalName ? (
              <p role="alert" className="text-xs text-destructive">
                {t("plans.jump.signalNameInvalid")}
              </p>
            ) : null}
          </Field>
          <Field id={payloadId} label={t("plans.jump.payloadType")}>
            <Select<AgentParameterType>
              id={payloadId}
              value={call.payloadType ?? "text"}
              disabled={props.isDisabled}
              className="w-full"
              options={PLAN_ENTRY_VALUE_TYPES.map((type) => ({
                value: type,
                label: t(`plans.entry.type.${type}`),
              }))}
              onValueChange={(payloadType) => form.changeCall({ payloadType })}
            />
          </Field>
        </>
      ) : null}
      <TimeoutField {...props} />
    </>
  );
}

/** The time limit of a waiting call: whole minutes, or explicitly none; a call that does not wait has none. */
function TimeoutField(
  props: PlanJumpOutFieldsProps,
): React.ReactElement | null {
  const { t } = useTranslation();
  const id = useId();
  const { form } = props;
  const { call, minutes } = form.state;
  if (call.wait === "continue") return null;
  const isUnlimited = call.timeout.kind === "unlimited";
  return (
    <Field id={id} label={t("plans.jump.timeout")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Input
            id={id}
            size="sm"
            type="number"
            inputMode="numeric"
            min={1}
            max={PLAN_JUMP_MAX_MINUTES}
            step={1}
            value={minutes}
            disabled={props.isDisabled || isUnlimited}
            aria-invalid={form.issues.timeout}
            className="w-24"
            onChange={(event) => form.setMinutes(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            {t("plans.jump.minutes")}
          </span>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={isUnlimited}
            disabled={props.isDisabled}
            onChange={(event) => form.setUnlimited(event.target.checked)}
          />
          {t("plans.jump.unlimited")}
        </label>
      </div>
      {form.issues.timeout ? (
        <p role="alert" className="text-xs text-destructive">
          {t("plans.jump.timeoutInvalid", { max: PLAN_JUMP_MAX_MINUTES })}
        </p>
      ) : null}
    </Field>
  );
}

/** Whose workspace the called plan works in; a call that does not wait never shares one. */
function WorkspaceField(props: PlanJumpOutFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const { form } = props;
  const { call } = form.state;
  const isContinue = call.wait === "continue";
  const workspaces: readonly AgentPlanJumpWorkspace[] = ["own", "shared"];
  return (
    <Field id={id} label={t("plans.jump.workspace.label")}>
      <Select<AgentPlanJumpWorkspace>
        id={id}
        value={call.workspace}
        disabled={props.isDisabled}
        className="w-full"
        options={workspaces.map((workspace) => ({
          value: workspace,
          label: t(`plans.jump.workspace.${workspace}`),
          description: t(`plans.jump.workspace.${workspace}Hint`),
          disabled: workspace === "shared" && isContinue,
        }))}
        onValueChange={(workspace) => form.changeCall({ workspace })}
      />
      {isContinue ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.jump.continueHint")}
        </p>
      ) : null}
    </Field>
  );
}

/**
 * The settings of a calling Jump: its target, what it waits for, how long, and whose workspace the target uses.
 * @remarks
 * Only plans and entries the person may call are offered. A wait that does not
 * wait has no time limit and no shared workspace.
 */
export function PlanJumpOutFields(
  props: PlanJumpOutFieldsProps,
): React.ReactElement {
  return (
    <div className="space-y-4" data-plan-jump-fields="out">
      <TargetFields {...props} />
      <WaitFields {...props} />
      <WorkspaceField {...props} />
    </div>
  );
}
