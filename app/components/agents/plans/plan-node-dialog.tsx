import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import { findPlanLoopMember } from "@/definition/AgentPlanLoopEdit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { PlanGroupPanel } from "./plan-group-panel";
import { PlanLoopPanel } from "./plan-loop-panel";
import { PlanNodeConfigurationFields } from "./plan-node-configuration-fields";
import { PlanScriptDialog } from "./plan-script/plan-script-dialog";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type {
  AgentPlanScript,
  AgentPlanScriptConfiguration,
} from "@/definition/AgentPlanScript";
import type { usePlanEditor } from "./use-plan-editor";

interface PlanNodeDialogProps {
  readonly nodeId: string | null;
  readonly editor: ReturnType<typeof usePlanEditor>;
  /** The run shown on the canvas, which a loop's panel reports on. */
  readonly run: AgentPlanRun | null;
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

/** Closes a settings panel and returns the focus to the node it belonged to, without moving the canvas. */
function closePanel(close: () => void, nodeId: string): void {
  close();
  for (const handle of document.querySelectorAll<HTMLElement>(
    "[data-plan-handle]",
  )) {
    if (handle.dataset.planHandle !== nodeId) continue;
    handle.focus({ preventScroll: true });
    return;
  }
}

/** The node a dialog edits: a top-level node, or an agent or script inside a frame. */
function dialogNode(
  draft: AgentPlanInput,
  nodeId: string | null,
): AgentPlanNode | undefined {
  if (nodeId === null) return undefined;
  return (
    draft.nodes.find((node) => node.id === nodeId) ??
    findPlanStep(draft, nodeId)?.step ??
    findPlanLoopMember(draft, nodeId)?.member
  );
}

/** Double-click editing stays bound to one node identifier, also while a run is active. */
export function PlanNodeDialog(props: PlanNodeDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const step = dialogNode(props.editor.draft, props.nodeId);
  if (step?.type === "script")
    return <PlanScriptEditDialog {...props} script={step} />;
  if (step?.type === "loop")
    return (
      <PlanLoopPanel
        key={step.id}
        loop={step}
        draft={props.editor.draft}
        sources={props.editor.sources}
        graph={props.editor.graph}
        run={props.run}
        isDisabled={!props.editor.canEdit || props.editor.isPending}
        onClose={() => closePanel(props.onClose, step.id)}
      />
    );
  if (step?.type === "group")
    return (
      <PlanGroupPanel
        key={step.id}
        group={step}
        draft={props.editor.draft}
        sources={props.editor.sources}
        graph={props.editor.graph}
        isDisabled={!props.editor.canEdit || props.editor.isPending}
        onClose={() => closePanel(props.onClose, step.id)}
      />
    );
  return (
    <Dialog
      open={step?.type === "agent"}
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
        <Button onClick={props.onClose}>{t("plans.closeNode")}</Button>
      </DialogContent>
    </Dialog>
  );
}
