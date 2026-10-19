import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { PlanGroupEditor } from "./plan-group-editor";
import { PlanNodeConfigurationFields } from "./plan-node-configuration-fields";
import { PlanScriptDialog } from "./plan-script/plan-script-dialog";

import type { AgentPlanBinding } from "@/definition/AgentPlan";
import type {
  AgentPlanScript,
  AgentPlanScriptConfiguration,
} from "@/definition/AgentPlanScript";
import type { usePlanEditor } from "./use-plan-editor";

interface PlanNodeDialogProps {
  readonly nodeId: string | null;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly onClose: () => void;
}

/** A script is edited in its own dialog, which applies a checked copy. */
function PlanScriptEditDialog(
  props: PlanNodeDialogProps & { readonly script: AgentPlanScript },
): React.ReactElement {
  const { script, editor } = props;
  function apply(
    configuration: AgentPlanScriptConfiguration,
    bindings: Readonly<Record<string, AgentPlanBinding>>,
  ): void {
    editor.graph.replaceNode({ ...script, ...configuration, bindings });
    props.onClose();
  }
  function restoreFocus(event: Event): void {
    event.preventDefault();
    document
      .querySelector<HTMLElement>(
        `[data-plan-handle="${CSS.escape(script.id)}"]`,
      )
      ?.focus({ preventScroll: true });
  }
  return (
    <PlanScriptDialog
      key={script.id}
      script={script}
      interpreters={editor.sources.interpreters}
      disabled={!editor.canEdit || editor.isPending}
      onApply={apply}
      onClose={props.onClose}
      onCloseAutoFocus={restoreFocus}
    />
  );
}

/** Double-click editing stays bound to one node identifier, also while a run is active. */
export function PlanNodeDialog(props: PlanNodeDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const step =
    props.editor.draft.nodes.find((node) => node.id === props.nodeId) ??
    (props.nodeId === null
      ? undefined
      : findPlanStep(props.editor.draft, props.nodeId)?.step);
  if (step?.type === "script")
    return <PlanScriptEditDialog {...props} script={step} />;
  return (
    <Dialog
      open={step?.type === "agent" || step?.type === "group"}
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
    >
      <DialogContent size="lg" className="space-y-4 overflow-y-auto">
        <DialogTitle className="text-lg font-semibold">
          {t("plans.editNode")}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("plans.nodeConfigurationHint")}
        </DialogDescription>
        {step?.type === "agent" ? (
          <PlanNodeConfigurationFields
            step={step}
            sources={props.editor.sources}
            disabled={!props.editor.canEdit || props.editor.isPending}
            onChange={props.editor.graph.replaceStep}
          />
        ) : null}
        {step?.type === "group" ? (
          <PlanGroupEditor
            group={step}
            draft={props.editor.draft}
            sources={props.editor.sources}
            graph={props.editor.graph}
            disabled={!props.editor.canEdit || props.editor.isPending}
          />
        ) : null}
        <Button onClick={props.onClose}>{t("plans.closeNode")}</Button>
      </DialogContent>
    </Dialog>
  );
}
