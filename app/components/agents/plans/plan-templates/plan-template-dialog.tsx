import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";
import { PLAN_TEMPLATE_NAME_LENGTH } from "@/definition/AgentPlanNodeTemplate";

import { planNodeAccent } from "../plan-layout";
import { PlanNodeIcon } from "../plan-node-icon";
import { savePlanTemplate } from "./plan-template-requests";
import {
  planTemplateError,
  planTemplateSaveDetails,
  planTemplateSuggestion,
} from "./plan-template-summary";

import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";
import type { PlanValueContext } from "../plan-node-card/plan-value-preview";
import type { PlanTemplateTarget } from "./plan-template-requests";

interface PlanTemplateDialogProps {
  /** The node as the draft held it when the person chose to save it. */
  readonly node: AgentPlanTemplateNode;
  readonly target: PlanTemplateTarget;
  readonly context: PlanValueContext;
  readonly onSaved: (template: AgentPlanNodeTemplate) => void;
  readonly onClose: () => void;
}

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly error: string };

/** The name, its save state and the focus after the dialog closes. */
function useTemplateSave(props: PlanTemplateDialogProps): {
  readonly name: string;
  readonly state: SaveState;
  readonly rename: (name: string) => void;
  readonly submit: (event: React.FormEvent) => void;
  readonly restoreFocus: (event: Event) => void;
} {
  const { node } = props;
  const [name, setName] = useState(() =>
    planTemplateSuggestion(node, props.context).slice(
      0,
      PLAN_TEMPLATE_NAME_LENGTH,
    ),
  );
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const saved = useRef(false);
  async function save(): Promise<void> {
    setState({ kind: "saving" });
    const result = await savePlanTemplate(props.target, { name, node });
    if (!result.ok) {
      setState({ kind: "failed", error: result.error });
      return;
    }
    saved.current = true;
    props.onSaved(result.value);
  }
  return {
    name,
    state,
    rename: (next) => {
      setName(next);
      if (state.kind === "failed") setState({ kind: "idle" });
    },
    submit: (event) => {
      event.preventDefault();
      if (name.trim() !== "" && state.kind !== "saving") void save();
    },
    restoreFocus: (event) => {
      event.preventDefault();
      // A saved template takes the focus in the list; a cancel returns to the node.
      if (saved.current) return;
      document
        .querySelector<HTMLElement>(
          `[data-plan-handle="${CSS.escape(node.id)}"]`,
        )
        ?.focus({ preventScroll: true });
    },
  };
}

/**
 * Names a node configuration and saves it as a personal template.
 *
 * @remarks
 * The name starts as the node's own name and stays editable. Cancel writes
 * nothing; a refused save keeps the dialog open with its reason. Saving
 * never changes the plan.
 */
export function PlanTemplateDialog(
  props: PlanTemplateDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { node } = props;
  const save = useTemplateSave(props);
  const isSaving = save.state.kind === "saving";
  // The suggested name stays unselected, with the caret after it.
  function placeCaret(event: Event): void {
    const content = event.currentTarget;
    const field =
      content instanceof HTMLElement ? content.querySelector("input") : null;
    if (!field) return;
    event.preventDefault();
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !isSaving) props.onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={placeCaret}
        onCloseAutoFocus={save.restoreFocus}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <PlanNodeIcon
              type={node.type}
              className={cn("size-5 shrink-0", planNodeAccent(node.type))}
            />
            <DialogTitle className="text-lg font-semibold">
              {t("plans.templates.saveTitle")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            {t(`plans.templates.saveDescription.${node.type}`)}
          </DialogDescription>
        </div>
        <form onSubmit={save.submit} noValidate className="mt-5 space-y-6">
          <TemplateNameField {...props} save={save} />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={props.onClose}
            >
              {t("settings.agents.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              isPending={isSaving}
              disabled={save.name.trim() === ""}
            >
              {t(isSaving ? "plans.templates.saving" : "plans.templates.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The editable name, the type line and why the name cannot be saved. */
function TemplateNameField(
  props: PlanTemplateDialogProps & {
    readonly save: ReturnType<typeof useTemplateSave>;
  },
): React.ReactElement {
  const { t } = useTranslation();
  const inputId = useId();
  const messageId = useId();
  const { name, state } = props.save;
  const isEmpty = name.trim() === "";
  let message: string | null = null;
  if (isEmpty) message = t("plans.templates.nameRequired");
  else if (state.kind === "failed")
    message = t("plans.templates.saveFailed", {
      reason: planTemplateError(t, state.error),
    });
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="block text-xs font-medium">
        {t("plans.templates.name")}
      </label>
      <Input
        id={inputId}
        value={name}
        maxLength={PLAN_TEMPLATE_NAME_LENGTH}
        required
        autoComplete="off"
        aria-invalid={message !== null}
        aria-describedby={messageId}
        disabled={state.kind === "saving"}
        onChange={(event) => props.save.rename(event.target.value)}
      />
      <div className="pt-0.5">
        <TemplateTypeLine node={props.node} context={props.context} />
      </div>
      <p
        id={messageId}
        role="alert"
        className="text-xs text-destructive empty:hidden"
      >
        {message}
      </p>
    </div>
  );
}

/** The node type in its color and what the template keeps, below the name. */
function TemplateTypeLine(props: {
  readonly node: AgentPlanTemplateNode;
  readonly context: PlanValueContext;
}): React.ReactElement {
  const { t } = useTranslation();
  const { node } = props;
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className={cn("shrink-0 font-medium", planNodeAccent(node.type))}>
        {t(`plans.nodeType.${node.type}`)}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">
        {planTemplateSaveDetails(node, props.context).join(" · ")}
      </span>
    </div>
  );
}
