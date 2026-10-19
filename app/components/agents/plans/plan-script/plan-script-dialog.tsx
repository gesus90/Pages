import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { PlanNodeIcon } from "../plan-node-icon";
import {
  PlanScriptContentField,
  PlanScriptNameField,
  PlanScriptProfileField,
  PlanScriptTimeoutField,
} from "./plan-script-fields";
import {
  PlanScriptInputsField,
  PlanScriptOutputField,
} from "./plan-script-inputs";
import { usePlanScriptForm } from "./use-plan-script-form";

import type { AgentPlanBinding } from "@/definition/AgentPlan";
import type {
  AgentPlanInterpreter,
  AgentPlanScript,
  AgentPlanScriptConfiguration,
} from "@/definition/AgentPlanScript";

interface PlanScriptDialogProps {
  /** The script to edit, or `null` to configure a new one. */
  readonly script: AgentPlanScript | null;
  readonly interpreters: readonly AgentPlanInterpreter[] | undefined;
  /** Read only: the fields stay visible, nothing is applied. */
  readonly disabled: boolean;
  readonly onApply: (
    configuration: AgentPlanScriptConfiguration,
    bindings: Readonly<Record<string, AgentPlanBinding>>,
  ) => void;
  readonly onClose: () => void;
  /** Where the focus goes when the dialog closes. */
  readonly onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Configures a script: name, interpreter profile, content, declared inputs
 * and output, and timeout.
 *
 * @remarks
 * The dialog edits a copy and applies it only when every field is valid,
 * by the rules the server checks again when the plan is saved. Applying
 * changes the draft only; nothing is saved or run. Inputs keep their
 * connections when they are renamed.
 */
export function PlanScriptDialog(
  props: PlanScriptDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const form = usePlanScriptForm(props.script, {
    interpreters: props.interpreters,
    defaultOutput: t("plans.scripts.defaultOutput"),
  });
  const isNew = props.script === null;
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (props.disabled) return;
    const result = form.submit();
    if (!result) {
      // The first invalid field takes the focus once its message is shown.
      const fields = event.currentTarget;
      requestAnimationFrame(() =>
        fields.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    props.onApply(result.configuration, result.bindings);
  }
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
    >
      <DialogContent
        size="lg"
        className="space-y-4 overflow-y-auto"
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <PlanNodeIcon
              type="script"
              className="size-5 shrink-0 text-plan-script"
            />
            <DialogTitle className="text-lg font-semibold">
              {isNew
                ? t("plans.palette.addTitle", {
                    type: t("plans.nodeType.script"),
                  })
                : t("plans.scripts.editTitle")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("plans.scripts.description")}
          </DialogDescription>
        </div>
        <form onSubmit={submit} noValidate className="space-y-4">
          <fieldset disabled={props.disabled} className="space-y-4">
            <PlanScriptNameField form={form} />
            <PlanScriptProfileField
              form={form}
              interpreters={props.interpreters}
            />
            <PlanScriptContentField form={form} />
            <PlanScriptInputsField form={form} />
            <PlanScriptOutputField form={form} />
            <PlanScriptTimeoutField form={form} />
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={props.onClose}>
              {t(
                props.disabled
                  ? "plans.scripts.close"
                  : "settings.agents.cancel",
              )}
            </Button>
            {props.disabled ? null : (
              <Button type="submit" size="sm">
                {t(isNew ? "plans.palette.add" : "plans.closeNode")}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
