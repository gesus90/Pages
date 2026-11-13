import { useState } from "react";

import {
  isSamePlanTarget,
  planTargetDeviations,
  withPlanTargetFollowed,
} from "@/definition/AgentPlanTarget";
import { isPlanAdministrator } from "@/definition/AgentPlanTeam";

import {
  isPlanNameUsed,
  planLocationFields,
  planLocationValue,
} from "./plan-context-model";
import { hasPlanTeamRight } from "./plan-access-model";
import { usePlanOneShotChoice } from "./plan-one-shot-field";
import { useEditSave } from "./use-plan-settings-save";
import { usePlanTeams } from "./use-plan-teams";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { PlanContextValues } from "./plan-context-model";
import type { usePlanEditor } from "../use-plan-editor";
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
  const [values, setValues] = useState(() => ({
    name: draft.name,
    projectId: draft.projectId ?? plan.projectId,
    location: planLocationValue(draft),
  }));
  const [choice, setChoice] = useState<"keep" | "follow" | null>(null);
  const [ownerId, setOwnerId] = useState(plan.ownerId);
  const teams = usePlanTeams(page.directory, plan.teams ?? []);
  const oneShot = usePlanOneShotChoice(draft.oneShot === true);
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
    ownerId,
    setOwnerId,
    deviations,
    choice,
    setChoice,
    submit,
  };
}
