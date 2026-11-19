import { useEffect, useState } from "react";

import {
  isSamePlanTarget,
  planTargetDeviations,
  withPlanTargetFollowed,
} from "@/definition/AgentPlanTarget";
import { isPlanAdministrator } from "@/definition/AgentPlanTeam";

import { usePlanRevisionState } from "../use-plan-revision-state";
import {
  isPlanNameUsed,
  planLocationFields,
  planLocationValue,
} from "./plan-context-model";
import { hasPlanTeamRight } from "./plan-access-model";
import { usePlanOneShotChoice } from "./plan-one-shot-field";
import { usePlanTeams } from "./use-plan-teams";

import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { PlanContextValues } from "./plan-context-model";
import type { usePlanEditor } from "../use-plan-editor";
import type { PlanEditorAccess } from "../use-plan-submission";
import type { usePlanManagement } from "./use-plan-management";

export interface PlanEditDialogProps {
  readonly page: AgentPlanPage;
  readonly plan: AgentPlanView;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly management: ReturnType<typeof usePlanManagement>;
}

interface PlanEditSettings {
  readonly values: PlanContextValues;
  readonly setValues: (values: PlanContextValues) => void;
  readonly teams: ReturnType<typeof usePlanTeams>;
  readonly oneShot: ReturnType<typeof usePlanOneShotChoice>;
  readonly save: ReturnType<typeof useEditSave>;
  readonly isReadOnly: boolean;
  readonly isLocked: boolean;
  readonly isIncomplete: boolean;
  readonly isOutdated: boolean;
  readonly ownerId: string;
  readonly setOwnerId: (ownerId: string) => void;
  readonly deviations: ReturnType<typeof planTargetDeviations>;
  readonly choice: "keep" | "follow" | null;
  readonly setChoice: (choice: "keep" | "follow") => void;
  readonly submit: () => void;
}

/** Keeps draft context and explicit team changes together until one atomic settings save. */
export function usePlanEditSettings({
  page,
  plan,
  editor,
  management,
}: PlanEditDialogProps): PlanEditSettings {
  const { draft } = editor;
  const {
    fields: form,
    values,
    setValues,
    ownerId,
    setOwnerId,
    teams,
    oneShot,
  } = usePlanEditFields(page, plan, draft);
  const [choice, setChoice] = useState<"keep" | "follow" | null>(null);
  const save = useEditSave(editor, management.close);
  const isReadOnly = !editor.canEdit && !isPlanAdministrator(plan);
  const isLocked = isReadOnly || (save.isSubmitted && editor.isPending);
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
    !values.name.trim() ||
    isTaken ||
    (deviations.length > 0 && choice === null);
  function submit(): void {
    if (isReadOnly) {
      management.open("clone");
      return;
    }
    if (!fields) return;
    const followIds = new Set(
      choice === "follow" ? deviations.map((node) => node.id) : [],
    );
    save.submit(
      (current) =>
        withPlanTargetFollowed(
          {
            ...current,
            revision: form.revision,
            name: values.name.trim(),
            projectId: values.projectId,
            workspaceId: fields.workspaceId,
            executionTarget: fields.executionTarget,
            oneShot: oneShot.isOneShot ? true : undefined,
          },
          followIds,
        ),
      {
        ...(plan.rights?.canManageTeams
          ? { teams: teams.teams.filter(hasPlanTeamRight) }
          : {}),
        ...(ownerId !== plan.ownerId ? { ownerId } : {}),
      },
    );
  }
  return {
    values,
    setValues,
    teams,
    oneShot,
    save,
    isReadOnly,
    isLocked,
    isIncomplete: Boolean(isIncomplete),
    isOutdated: form.revision < plan.revision,
    ownerId,
    setOwnerId,
    deviations,
    choice,
    setChoice,
    submit,
  };
}

function useEditSave(
  editor: ReturnType<typeof usePlanEditor>,
  onClose: () => void,
): {
  readonly isSubmitted: boolean;
  readonly submit: (
    change: (draft: AgentPlanInput) => AgentPlanInput,
    access: PlanEditorAccess,
  ) => void;
  readonly error: string | null;
} {
  const [isSubmitted, setSubmitted] = useState(false);
  const result = editor.isPending ? undefined : editor.command.data;
  const answer = isSubmitted && result?.intent === "save-plan" ? result : null;
  const isDone =
    answer?.ok === true ||
    (answer?.ok === false && answer.error === "plan_conflict");
  useEffect(() => {
    if (isDone) onClose();
  }, [isDone, onClose]);
  return {
    isSubmitted,
    submit: (change, access) => {
      setSubmitted(true);
      editor.saveWith(change, access);
    },
    error: answer?.ok === false ? answer.error : null,
  };
}

interface PlanEditFields {
  readonly fields: ReturnType<typeof usePlanRevisionState<EditFields>>;
  readonly values: PlanContextValues;
  readonly setValues: (values: PlanContextValues) => void;
  readonly ownerId: string;
  readonly setOwnerId: (ownerId: string) => void;
  readonly teams: ReturnType<typeof usePlanTeams>;
  readonly oneShot: ReturnType<typeof usePlanOneShotChoice>;
}

interface EditFields {
  readonly values: PlanContextValues;
  readonly ownerId: string;
  readonly teams: NonNullable<AgentPlanView["teams"]>;
  readonly isOneShot: boolean;
}

function usePlanEditFields(
  page: AgentPlanPage,
  plan: AgentPlanView,
  draft: AgentPlanInput,
): PlanEditFields {
  const fields = usePlanRevisionState<EditFields>(
    {
      values: {
        name: draft.name,
        projectId: draft.projectId ?? plan.projectId,
        location: planLocationValue(draft),
      },
      ownerId: plan.ownerId,
      teams: plan.teams ?? [],
      isOneShot: draft.oneShot === true,
    },
    Math.min(draft.revision ?? plan.revision, plan.revision),
  );
  const { values, ownerId } = fields.current;
  const setValues = (nextValues: PlanContextValues): void =>
    fields.setCurrent({ ...fields.current, values: nextValues });
  const setOwnerId = (nextOwnerId: string): void =>
    fields.setCurrent({ ...fields.current, ownerId: nextOwnerId });
  const teams = usePlanTeams(page.directory, plan.teams ?? [], {
    teams: fields.current.teams,
    setTeams: (nextTeams) =>
      fields.setCurrent({ ...fields.current, teams: nextTeams }),
  });
  const oneShot = usePlanOneShotChoice(draft.oneShot === true, {
    isOneShot: fields.current.isOneShot,
    setOneShot: (isOneShot) =>
      fields.setCurrent({ ...fields.current, isOneShot }),
  });
  return { fields, values, setValues, ownerId, setOwnerId, teams, oneShot };
}
