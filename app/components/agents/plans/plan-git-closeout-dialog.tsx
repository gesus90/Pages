import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

import { planNodeAccent } from "./plan-layout";
import { PlanNodeIcon } from "./plan-node-icon";

import type { AgentPlanGitCloseout } from "@/definition/AgentPlanGitCloseout";
import type { PlanGraphActions } from "./use-plan-graph";

interface PlanGitCloseoutDialogProps {
  readonly closeout: AgentPlanGitCloseout;
  readonly graph: PlanGraphActions;
  /** Whether the plan cannot be changed now: no edit right, or a command is on its way. */
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}

/** One saved setting, shown as text that cannot be edited. */
function SavedSetting(props: {
  readonly label: string;
  readonly value: string;
  readonly isCode?: boolean;
}): React.ReactElement {
  return (
    <div className="space-y-1 text-sm">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd
        className={cn(
          "rounded-md border border-border bg-muted/50 px-3 py-2 break-words whitespace-pre-wrap",
          props.isCode && "font-mono text-xs",
        )}
      >
        {props.value}
      </dd>
    </div>
  );
}

/**
 * Explains that a saved Git closeout is no longer supported and lets its owner remove it.
 *
 * @remarks
 * The node of an earlier version (PAGE-285) is shown as it was saved; nothing
 * here edits or converts it. Removing it changes the draft only, like the
 * remove action of its card, and is saved with the plan.
 */
export function PlanGitCloseoutDialog(
  props: PlanGitCloseoutDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { closeout } = props;
  function remove(): void {
    if (props.isDisabled) return;
    props.graph.remove(closeout.id);
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
        data-plan-dialog="git-closeout"
      >
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
          <PlanNodeIcon
            type="git_closeout"
            className={cn("size-5 shrink-0", planNodeAccent("git_closeout"))}
          />
          {t("plans.gitCloseout.legacyTitle")}
        </DialogTitle>
        <DialogDescription className="text-sm text-destructive">
          {t("plans.gitCloseout.legacyDescription")}
        </DialogDescription>
        <dl className="space-y-3">
          <SavedSetting
            label={t("plans.gitCloseout.name")}
            value={closeout.name}
          />
          <SavedSetting
            label={t("plans.gitCloseout.checkCommand")}
            value={
              closeout.checkCommand ||
              t("plans.gitCloseout.checkCommandMissing")
            }
            isCode={closeout.checkCommand !== ""}
          />
          <SavedSetting
            label={t("plans.gitCloseout.timeout")}
            value={String(closeout.timeoutSeconds)}
          />
        </dl>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={props.onClose}>
            {t("plans.gitCloseout.close")}
          </Button>
          {props.isDisabled ? null : (
            <Button variant="destructive-soft" size="sm" onClick={remove}>
              {t("plans.gitCloseout.remove")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
