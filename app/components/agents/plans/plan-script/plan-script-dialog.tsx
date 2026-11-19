import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { scriptLocalPaths } from "@/definition/AgentPlanTarget";

import { PlanExecutionTargetSelect } from "../plan-execution-target-select";
import { PlanNodeIcon } from "../plan-node-icon";
import {
  PlanScriptContentField,
  PlanScriptDisabledField,
  PlanScriptNameField,
  PlanScriptProfileField,
  PlanScriptTimeoutField,
} from "./plan-script-fields";
import {
  PlanScriptInputsField,
  PlanScriptOutputField,
} from "./plan-script-inputs";
import { usePlanScriptForm } from "./use-plan-script-form";

import type {
  AgentPlanExecutionTarget,
  AgentPlanRemoteTarget,
} from "@/definition/AgentPlanExecution";
import type { PlanScriptForm } from "./use-plan-script-form";
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
  readonly remoteTargets?: readonly AgentPlanRemoteTarget[];
  /** The plan's target, which the script runs on without one of its own. */
  readonly planTarget?: AgentPlanExecutionTarget;
  /** Read only: the fields stay visible, nothing is applied. */
  readonly disabled: boolean;
  readonly workspace?: { readonly name: string; readonly path: string };
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
    planTarget: props.planTarget,
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
        overlayClassName="bg-transparent"
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
            {t("plans.nodeConfigurationHint")}
          </DialogDescription>
        </div>
        <form onSubmit={submit} noValidate className="space-y-4">
          <fieldset disabled={props.disabled} className="space-y-4">
            <PlanScriptNameField form={form} />
            <PlanScriptTargetField
              form={form}
              choices={props.remoteTargets ?? []}
              workspace={props.workspace}
            />
            <PlanScriptProfileField
              form={form}
              interpreters={props.interpreters}
            />
            <PlanScriptContentField form={form} />
            <PlanScriptOutputField form={form} />
            <PlanScriptDisabledField form={form} />
            <PlanScriptOptions form={form} />
          </fieldset>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
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

/** Keeps declared inputs, output semantics and timeout available beside the compact primary fields. */
function PlanScriptOptions({
  form,
}: {
  readonly form: PlanScriptForm;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <details
      className="space-y-3"
      open={
        form.isShown("timeout") &&
        (form.issues.fields.has("timeout") || form.issues.rows.size > 0)
          ? true
          : undefined
      }
    >
      <summary className="cursor-pointer text-sm text-muted-foreground">
        {t("plans.execution.advanced")}
      </summary>
      <p className="text-xs text-muted-foreground">
        {t("plans.scripts.outputHint")}
      </p>
      <PlanScriptInputsField form={form} />
      <PlanScriptTimeoutField form={form} />
    </details>
  );
}

function PlanScriptTargetField(props: {
  readonly form: PlanScriptForm;
  readonly choices: readonly AgentPlanRemoteTarget[];
  readonly workspace:
    { readonly name: string; readonly path: string } | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const target = props.form.effectiveTarget;
  const remote =
    target.kind === "remote"
      ? props.choices.find(
          (choice) => choice.workspaceId === target.workspaceId,
        )
      : undefined;
  const workspace = target.kind === "local" ? props.workspace : undefined;
  const host =
    target.kind === "local"
      ? t("plans.execution.local")
      : (remote?.connectionName ?? t("plans.execution.unavailable"));
  const localPaths =
    target.kind === "remote"
      ? scriptLocalPaths({ content: props.form.values.content })
      : [];
  return (
    <div className="space-y-3">
      <PlanExecutionTargetSelect
        id={id}
        target={props.form.values.executionTarget}
        planTarget={props.form.planTarget}
        choices={props.choices}
        onChange={(executionTarget) => props.form.change({ executionTarget })}
      />
      <div className="space-y-1 rounded-xl border border-border p-3 text-xs">
        <p className="font-semibold">{host}</p>
        <p>{remote?.workspaceName ?? workspace?.name}</p>
        <p className="wrap-anywhere text-muted-foreground">
          {remote?.path ?? workspace?.path}
        </p>
        {target.kind === "local" ? (
          <p className="text-muted-foreground">
            {t("plans.execution.scriptCheckHint")}
          </p>
        ) : null}
      </div>
      {localPaths.length > 0 ? (
        <p
          role="note"
          className="rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning"
        >
          {t("plans.execution.localPaths", { paths: localPaths.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}
