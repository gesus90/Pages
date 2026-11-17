import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { cn } from "@/app/lib/cn";
import { PLAN_JUMP_NAME_LENGTH } from "@/definition/AgentPlanJump";

import { planNodeAccent } from "../plan-layout";
import { PlanNodeIcon } from "../plan-node-icon";
import { PlanEntryInputsEditor } from "./plan-entry-values";
import { PlanJumpDialogShell } from "./plan-jump-dialog-shell";
import { PlanJumpOutFields } from "./plan-jump-out-fields";
import { usePlanJumpForm } from "./use-plan-jump-form";

import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanJump } from "@/definition/AgentPlanJump";
import type { PlanGraphActions } from "../use-plan-graph";
import type { PlanJumpForm } from "./use-plan-jump-form";

interface PlanJumpDialogProps {
  readonly jump: AgentPlanJump;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  /** Whether the plan cannot be changed now: no edit right, or a command is on its way. */
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}

/** The settings of a receiving Jump: its name, whether it takes calls, and the inputs it accepts. */
function InFields(props: {
  readonly form: PlanJumpForm;
  readonly isDisabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const nameId = useId();
  const { form } = props;
  const { entry } = form.state;
  return (
    <div className="space-y-4" data-plan-jump-fields="in">
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="block text-sm font-medium">
          {t("plans.jump.entryName")}
        </label>
        <Input
          id={nameId}
          size="sm"
          value={entry.name}
          maxLength={PLAN_JUMP_NAME_LENGTH}
          autoComplete="off"
          disabled={props.isDisabled}
          aria-invalid={form.issues.name}
          onChange={(event) => form.changeEntry({ name: event.target.value })}
        />
        {form.issues.name ? (
          <p role="alert" className="text-xs text-destructive">
            {t("plans.jump.entryNameInvalid")}
          </p>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={entry.isEnabled}
          disabled={props.isDisabled}
          onChange={(event) =>
            form.changeEntry({ isEnabled: event.target.checked })
          }
        />
        {t("plans.jump.entryEnabled")}
      </label>
      <PlanEntryInputsEditor
        entries={entry.inputs}
        isDisabled={props.isDisabled}
        onChange={(inputs) => form.changeEntry({ inputs })}
      />
      <p className="text-xs text-muted-foreground">
        {t("plans.jump.entryHint")}
      </p>
    </div>
  );
}

/**
 * The settings of a Jump behind its pencil, starting with the direction switch.
 * @remarks
 * Edits stay private until Apply. Switching the direction or the target never
 * rewires the plan: lines and bindings that no longer fit stay in the plan and
 * show as invalid on the card. A receiving entry belongs on the outer level
 * of the plan only; a Jump is never placed in a group or a loop.
 */
export function PlanJumpDialog(props: PlanJumpDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const form = usePlanJumpForm(props.jump, t("plans.jump.defaultName"));
  const { direction } = form.state;
  function apply(): void {
    if (props.isDisabled || !form.canApply) return;
    props.graph.replaceNode(form.result());
    props.onClose();
  }
  return (
    <PlanJumpDialogShell
      name="jump"
      title={
        <>
          <PlanNodeIcon
            type="jump"
            direction={direction}
            className={cn("size-5 shrink-0", planNodeAccent("jump"))}
          />
          {t(`plans.jump.title.${direction}`)}
        </>
      }
      description={t("plans.jump.dialog.hint")}
      isDisabled={props.isDisabled}
      canApply={form.canApply}
      onApply={apply}
      onClose={props.onClose}
    >
      <SegmentedControl
        value={direction}
        ariaLabel={t("plans.jump.direction.label")}
        isDisabled={props.isDisabled}
        options={[
          {
            value: "out",
            label: t("plans.jump.direction.out"),
            icon: <PlanNodeIcon type="jump" direction="out" />,
          },
          {
            value: "in",
            label: t("plans.jump.direction.in"),
            icon: <PlanNodeIcon type="jump" direction="in" />,
          },
        ]}
        onValueChange={form.setDirection}
      />
      {direction === "in" ? (
        <InFields form={form} isDisabled={props.isDisabled} />
      ) : (
        <PlanJumpOutFields
          form={form}
          targets={props.sources.callTargets}
          isDisabled={props.isDisabled}
        />
      )}
    </PlanJumpDialogShell>
  );
}
