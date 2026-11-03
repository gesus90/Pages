import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useId, useState } from "react";
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
import { PLAN_STACK_NAME_LENGTH } from "@/definition/AgentPlanStack";
import {
  movePlanStackEntry,
  removePlanStackEntry,
} from "@/definition/AgentPlanStackEdit";

import { planNodeAccent } from "./plan-layout";
import { PlanNodeIcon } from "./plan-node-icon";
import { planStackEntryLabel } from "./plan-stack-summary";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";
import type { PlanGraphActions } from "./use-plan-graph";

interface PlanStackDialogProps {
  readonly stack: AgentPlanStack;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  /** Whether the plan cannot be changed now: no edit right, or a command is on its way. */
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}

/** One entry in the order of the handover, with the buttons that move or remove it. */
function EntryRow(props: {
  readonly label: string;
  readonly position: number;
  readonly count: number;
  readonly isDisabled: boolean;
  readonly onMove: (offset: -1 | 1) => void;
  readonly onRemove: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const text = `${props.position} · ${props.label}`;
  return (
    <li className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm" title={text}>
        {text}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("plans.stack.dialog.up", { name: props.label })}
        disabled={props.isDisabled || props.position === 1}
        onClick={() => props.onMove(-1)}
      >
        <ArrowUp aria-hidden="true" className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("plans.stack.dialog.down", { name: props.label })}
        disabled={props.isDisabled || props.position === props.count}
        onClick={() => props.onMove(1)}
      >
        <ArrowDown aria-hidden="true" className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("plans.stack.dialog.remove", { name: props.label })}
        disabled={props.isDisabled}
        onClick={props.onRemove}
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </Button>
    </li>
  );
}

/** The entries of the edited stack, in the order of the handover. */
function StackEntryList(props: {
  readonly stack: AgentPlanStack;
  readonly context: Parameters<typeof planStackEntryLabel>[1];
  readonly isDisabled: boolean;
  readonly onChange: (stack: AgentPlanStack) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { stack } = props;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t("plans.stack.dialog.entries")}</h3>
      {stack.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("plans.stack.emptyHint")}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {stack.entries.map((entry, index) => (
            <EntryRow
              key={entry.id}
              label={planStackEntryLabel(entry, props.context)}
              position={index + 1}
              count={stack.entries.length}
              isDisabled={props.isDisabled}
              onMove={(offset) =>
                props.onChange(movePlanStackEntry(stack, entry.id, offset))
              }
              onRemove={() =>
                props.onChange(removePlanStackEntry(stack, entry.id))
              }
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The settings of a stack behind its pencil: its name and the order of its entries.
 *
 * @remarks
 * Edits stay private until Apply. The order is the order of the handover:
 * the first trigger hands over the first entry. Tickets join through the
 * card's ticket choice or by dragging a ticket or value card onto the stack.
 */
export function PlanStackDialog(
  props: PlanStackDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const nameId = useId();
  const [draft, setDraft] = useState(props.stack);
  const context = {
    draft: props.draft,
    sources: props.sources,
    workspaces: [],
    translate: t,
  };
  function apply(): void {
    if (props.isDisabled) return;
    props.graph.replaceNode({
      ...draft,
      name: draft.name.trim() || t("plans.stack.defaultName"),
    });
    props.onClose();
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
        size="sm"
        className="space-y-4"
        data-plan-dialog="stack"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onClose();
        }}
      >
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
          <PlanNodeIcon
            type="stack"
            className={cn("size-5 shrink-0", planNodeAccent("stack"))}
          />
          {t("plans.stack.dialog.title")}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("plans.stack.dialog.hint")}
        </DialogDescription>
        <label htmlFor={nameId} className="block space-y-1 text-sm">
          <span>{t("plans.stack.dialog.name")}</span>
          <Input
            id={nameId}
            value={draft.name}
            maxLength={PLAN_STACK_NAME_LENGTH}
            disabled={props.isDisabled}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        <StackEntryList
          stack={draft}
          context={context}
          isDisabled={props.isDisabled}
          onChange={setDraft}
        />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={props.onClose}>
            {t("settings.agents.cancel")}
          </Button>
          {props.isDisabled ? null : (
            <Button size="sm" onClick={apply}>
              {t("plans.closeNode")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
