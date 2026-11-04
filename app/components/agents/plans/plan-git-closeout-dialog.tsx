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
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/app/lib/cn";
import {
  PLAN_GIT_CLOSEOUT_COMMAND_LENGTH,
  PLAN_GIT_CLOSEOUT_NAME_LENGTH,
  PLAN_GIT_CLOSEOUT_TIMEOUT,
  planGitCloseoutIssues,
} from "@/definition/AgentPlanGitCloseout";

import { planNodeAccent } from "./plan-layout";
import { PlanNodeIcon } from "./plan-node-icon";

import type {
  AgentPlanGitCloseout,
  AgentPlanGitCloseoutIssue,
} from "@/definition/AgentPlanGitCloseout";
import type { PlanGraphActions } from "./use-plan-graph";

interface PlanGitCloseoutDialogProps {
  readonly closeout: AgentPlanGitCloseout;
  readonly graph: PlanGraphActions;
  /** Whether the plan cannot be changed now: no edit right, or a command is on its way. */
  readonly isDisabled: boolean;
  readonly onClose: () => void;
}

const TIMEOUT_RANGE = {
  minimum: PLAN_GIT_CLOSEOUT_TIMEOUT.minimum,
  maximum: PLAN_GIT_CLOSEOUT_TIMEOUT.maximum,
};

/** A label with its control, an optional hint and the message that belongs to the control. */
function CloseoutField(props: {
  readonly label: string;
  readonly hint?: string;
  readonly error: string | null;
  readonly children: (control: {
    readonly id: string;
    readonly describedBy: string | undefined;
    readonly isInvalid: boolean;
  }) => React.ReactElement;
}): React.ReactElement {
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const described = [props.hint ? hintId : null, props.error ? errorId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={baseId} className="block">
        {props.label}
      </label>
      {props.children({
        id: baseId,
        describedBy: described || undefined,
        isInvalid: props.error !== null,
      })}
      {props.hint ? (
        <span id={hintId} className="block text-xs text-muted-foreground">
          {props.hint}
        </span>
      ) : null}
      {props.error ? (
        <span
          id={errorId}
          role="alert"
          className="block text-xs text-destructive"
        >
          {props.error}
        </span>
      ) : null}
    </div>
  );
}

/** The three settings of the node; the process itself has none. */
function CloseoutFields(props: {
  readonly draft: AgentPlanGitCloseout;
  readonly issues: readonly AgentPlanGitCloseoutIssue[];
  readonly onChange: (draft: AgentPlanGitCloseout) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft, issues, onChange } = props;
  return (
    <>
      <CloseoutField
        label={t("plans.gitCloseout.name")}
        error={
          issues.includes("name") ? t("plans.gitCloseout.error.name") : null
        }
      >
        {(control) => (
          <Input
            id={control.id}
            value={draft.name}
            maxLength={PLAN_GIT_CLOSEOUT_NAME_LENGTH}
            aria-invalid={control.isInvalid}
            aria-describedby={control.describedBy}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
          />
        )}
      </CloseoutField>
      <CloseoutField
        label={t("plans.gitCloseout.checkCommand")}
        hint={t("plans.gitCloseout.checkCommandHint")}
        error={
          issues.includes("checkCommand")
            ? t("plans.gitCloseout.error.checkCommand", {
                maximum: PLAN_GIT_CLOSEOUT_COMMAND_LENGTH,
              })
            : null
        }
      >
        {(control) => (
          <Textarea
            id={control.id}
            rows={3}
            value={draft.checkCommand}
            spellCheck={false}
            maxLength={PLAN_GIT_CLOSEOUT_COMMAND_LENGTH}
            className="font-mono"
            aria-invalid={control.isInvalid}
            aria-describedby={control.describedBy}
            onChange={(event) =>
              onChange({ ...draft, checkCommand: event.target.value })
            }
          />
        )}
      </CloseoutField>
      <CloseoutField
        label={t("plans.gitCloseout.timeout")}
        hint={t("plans.gitCloseout.timeoutHint", TIMEOUT_RANGE)}
        error={
          issues.includes("timeout")
            ? t("plans.gitCloseout.error.timeout", TIMEOUT_RANGE)
            : null
        }
      >
        {(control) => (
          <Input
            id={control.id}
            type="number"
            min={PLAN_GIT_CLOSEOUT_TIMEOUT.minimum}
            max={PLAN_GIT_CLOSEOUT_TIMEOUT.maximum}
            step={1}
            value={draft.timeoutSeconds}
            aria-invalid={control.isInvalid}
            aria-describedby={control.describedBy}
            onChange={(event) =>
              onChange({ ...draft, timeoutSeconds: event.target.valueAsNumber })
            }
          />
        )}
      </CloseoutField>
    </>
  );
}

/**
 * Edits the name, the check command and the time limit of a Git closeout.
 *
 * @remarks
 * Applying changes the draft only; nothing is saved or run. An empty check
 * command is refused here, as a script without content is refused by its
 * dialog; the ticket is bound on the card.
 */
export function PlanGitCloseoutDialog(
  props: PlanGitCloseoutDialogProps,
): React.ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(props.closeout);
  const [hasTried, setHasTried] = useState(false);
  function apply(): void {
    setHasTried(true);
    if (props.isDisabled || planGitCloseoutIssues(draft).length > 0) return;
    props.graph.replaceNode({ ...draft, name: draft.name.trim() });
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
          {t("plans.gitCloseout.editTitle")}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t("plans.gitCloseout.description")}
        </DialogDescription>
        <fieldset disabled={props.isDisabled} className="space-y-4">
          <CloseoutFields
            draft={draft}
            issues={hasTried ? planGitCloseoutIssues(draft) : []}
            onChange={setDraft}
          />
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={props.onClose}>
            {t(
              props.isDisabled
                ? "plans.gitCloseout.close"
                : "settings.agents.cancel",
            )}
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
