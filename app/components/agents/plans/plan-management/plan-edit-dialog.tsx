import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  isSamePlanTarget,
  planTargetDeviations,
  withPlanTargetFollowed,
} from "@/definition/AgentPlanTarget";

import { planNodeLabel } from "../plan-layout";
import { PlanContextFields } from "./plan-context-fields";
import {
  isPlanNameUsed,
  planLocationFields,
  planLocationValue,
  planRequestError,
} from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";

import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { usePlanEditor } from "../use-plan-editor";
import type { PlanContextValues } from "./plan-context-model";
import type { usePlanManagement } from "./use-plan-management";

/** What the nodes with a target of their own do when the plan target changes. */
type DeviationChoice = "keep" | "follow";

/** The draft with the dialog's name, context and plan target. */
function editedDraft(
  draft: AgentPlanInput,
  change: {
    readonly values: PlanContextValues;
    readonly workspaceId: string;
    readonly target: AgentPlanExecutionTarget | undefined;
    readonly followIds: ReadonlySet<string>;
  },
): AgentPlanInput {
  const next: AgentPlanInput = {
    ...draft,
    name: change.values.name.trim(),
    workspaceId: change.workspaceId,
    projectId: change.values.projectId,
    executionTarget: change.target,
  };
  return withPlanTargetFollowed(next, change.followIds);
}

/** Saves through the editor and closes once the save is acknowledged. */
function useEditSave(
  editor: ReturnType<typeof usePlanEditor>,
  onClose: () => void,
): {
  readonly isSubmitted: boolean;
  readonly submit: (change: (draft: AgentPlanInput) => AgentPlanInput) => void;
  readonly error: string | null;
} {
  const [isSubmitted, setSubmitted] = useState(false);
  const result = editor.isPending ? undefined : editor.command.data;
  const answer = isSubmitted && result?.intent === "save-plan" ? result : null;
  // A conflicting revision is explained by the editor's conflict dialog instead.
  const isDone =
    answer?.ok === true ||
    (answer?.ok === false && answer.error === "plan_conflict");
  useEffect(() => {
    if (isDone) onClose();
  }, [isDone, onClose]);
  return {
    isSubmitted,
    submit: (change) => {
      setSubmitted(true);
      editor.saveWith(change);
    },
    error: answer?.ok === false ? answer.error : null,
  };
}

/**
 * Changes name, project and workspace of the plan, including its plan target.
 *
 * @remarks
 * Saving stores the next revision through the editor's revision-protected
 * save. Nodes with a target of their own that differs from the new plan
 * target are never rewritten silently: the person decides whether they keep
 * it or follow the plan. Only the owner moves the plan to another project.
 */
export function PlanEditDialog({
  page,
  plan,
  editor,
  management,
}: {
  readonly page: AgentPlanPage;
  readonly plan: AgentPlanView;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft } = editor;
  const [values, setValues] = useState<PlanContextValues>(() => ({
    name: draft.name,
    projectId: draft.projectId ?? plan.projectId,
    location: planLocationValue(draft),
  }));
  const [choice, setChoice] = useState<DeviationChoice | null>(null);
  const save = useEditSave(editor, management.close);
  const fields = planLocationFields(page, values);
  const deviations =
    fields && !isSamePlanTarget(fields.executionTarget, draft.executionTarget)
      ? planTargetDeviations(draft, fields.executionTarget)
      : [];
  const isTaken = isPlanNameUsed(page, {
    name: values.name,
    projectId: values.projectId,
    departmentId: plan.departmentId ?? null,
    exceptId: plan.id,
  });
  const isIncomplete =
    !fields ||
    values.name.trim() === "" ||
    isTaken ||
    (deviations.length > 0 && choice === null);
  function submit(): void {
    if (!fields) return;
    const followIds = new Set(
      choice === "follow" ? deviations.map((node) => node.id) : [],
    );
    save.submit((current) =>
      editedDraft(current, {
        values,
        workspaceId: fields.workspaceId,
        target: fields.executionTarget,
        followIds,
      }),
    );
  }
  return (
    <PlanDialogFrame
      title={t("plans.manage.editTitle")}
      submitLabel={t("plans.execution.save")}
      isPending={save.isSubmitted && editor.isPending}
      isSubmitDisabled={isIncomplete || !editor.canEdit}
      error={planRequestError(save.error, t)}
      onSubmit={submit}
      onClose={management.close}
    >
      <PlanContextFields
        page={page}
        values={values}
        onChange={setValues}
        isDisabled={!editor.canEdit || (save.isSubmitted && editor.isPending)}
        isProjectFixed={plan.ownerId !== page.userId}
        nameError={isTaken ? t("settings.agents.error.plan_name_taken") : null}
      />
      {deviations.length > 0 ? (
        <PlanDeviationChoice
          names={deviations.map((node) => planNodeLabel(node, editor.sources))}
          choice={choice}
          onChoose={setChoice}
        />
      ) : null}
      {editor.isDirty ? (
        <p role="note" className="text-xs text-muted-foreground">
          {t("plans.manage.editUnsaved")}
        </p>
      ) : null}
    </PlanDialogFrame>
  );
}

/** The explicit decision for nodes whose own target differs from the new plan target. */
function PlanDeviationChoice(props: {
  readonly names: readonly string[];
  readonly choice: DeviationChoice | null;
  readonly onChoose: (choice: DeviationChoice) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const titleId = useId();
  const shown = props.names.slice(0, 5);
  return (
    <div
      role="radiogroup"
      aria-labelledby={titleId}
      aria-required="true"
      className="space-y-2 rounded-xl bg-warning-subtle px-4 py-3 text-xs"
    >
      <p id={titleId} className="font-semibold text-warning">
        {t("plans.manage.deviationTitle")}
      </p>
      <p className="wrap-anywhere text-foreground">
        {t("plans.manage.deviationNodes", {
          count: props.names.length,
          names: shown.join(", "),
        })}
      </p>
      {(["keep", "follow"] as const).map((option) => (
        <label
          key={option}
          className="flex items-start gap-2 text-foreground [@media(pointer:coarse)]:min-h-11"
        >
          <input
            type="radio"
            name="plan-target-deviation"
            value={option}
            checked={props.choice === option}
            onChange={() => props.onChoose(option)}
          />
          <span>{t(`plans.manage.deviation.${option}`)}</span>
        </label>
      ))}
    </div>
  );
}
