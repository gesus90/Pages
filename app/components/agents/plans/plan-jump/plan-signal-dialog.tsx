import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";
import {
  PLAN_JUMP_SIGNAL_LENGTH,
  isPlanSignalName,
} from "@/definition/AgentPlanJump";

import { planNodeAccent } from "../plan-layout";
import { PlanNodeIcon } from "../plan-node-icon";
import { PLAN_ENTRY_VALUE_TYPES } from "./plan-entry-values";
import { PlanJumpDialogShell } from "./plan-jump-dialog-shell";

import type { AgentParameterType } from "@/definition/AgentParameters";
import type { AgentPlanSignal } from "@/definition/AgentPlanJump";
import type { PlanGraphActions } from "../use-plan-graph";

/** The choice of the payload type; none means a signal without a payload. */
type PayloadChoice = AgentParameterType | "none";

interface PlanSignalDialogProps {
  readonly signal: AgentPlanSignal;
  readonly graph: PlanGraphActions;
  /** Whether the plan cannot be changed now: no edit right, or a command is on its way. */
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}

/**
 * The settings of a signal behind its pencil: its name and the type of its optional payload.
 * @remarks
 * The receiver is fixed: the caller of the run. A run without a caller
 * continues without delivery. Removing the payload keeps a connection that
 * still ends at it in the plan, where it shows as invalid.
 */
export function PlanSignalDialog(
  props: PlanSignalDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const nameId = useId();
  const payloadId = useId();
  const [signalName, setSignalName] = useState(props.signal.signalName);
  const [payload, setPayload] = useState<PayloadChoice>(
    props.signal.payloadType ?? "none",
  );
  const trimmed = signalName.trim();
  const isValid = isPlanSignalName(trimmed);
  function apply(): void {
    if (props.isDisabled || !isValid) return;
    props.graph.replaceNode({
      ...props.signal,
      signalName: trimmed,
      payloadType: payload === "none" ? undefined : payload,
    });
    props.onClose();
  }
  return (
    <PlanJumpDialogShell
      name="signal"
      title={
        <>
          <PlanNodeIcon
            type="signal"
            className={cn("size-5 shrink-0", planNodeAccent("signal"))}
          />
          {t("plans.signal.dialog.title")}
        </>
      }
      description={t("plans.signal.dialog.hint")}
      isDisabled={props.isDisabled}
      canApply={isValid}
      onApply={apply}
      onClose={props.onClose}
    >
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="block text-sm font-medium">
          {t("plans.signal.name")}
        </label>
        <Input
          id={nameId}
          size="sm"
          value={signalName}
          maxLength={PLAN_JUMP_SIGNAL_LENGTH}
          autoComplete="off"
          spellCheck={false}
          disabled={props.isDisabled}
          aria-invalid={!isValid}
          className="font-mono"
          onChange={(event) => setSignalName(event.target.value)}
        />
        {isValid ? null : (
          <p role="alert" className="text-xs text-destructive">
            {t("plans.jump.signalNameInvalid")}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={payloadId} className="block text-sm font-medium">
          {t("plans.signal.payload")}
        </label>
        <Select<PayloadChoice>
          id={payloadId}
          value={payload}
          disabled={props.isDisabled}
          className="w-full"
          options={[
            { value: "none", label: t("plans.signal.noPayload") },
            ...PLAN_ENTRY_VALUE_TYPES.map((type) => ({
              value: type,
              label: t(`plans.entry.type.${type}`),
            })),
          ]}
          onValueChange={setPayload}
        />
        <p className="text-xs text-muted-foreground">
          {t("plans.signal.payloadHint")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("plans.signal.receiverHint")}
      </p>
    </PlanJumpDialogShell>
  );
}
