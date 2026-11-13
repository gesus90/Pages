import { useState } from "react";
import { useTranslation } from "react-i18next";

import { suggestOneShotCopyName } from "@/definition/AgentPlanOneShot";
import { fullPlanTeam } from "@/definition/AgentPlanTeam";

import { planLocationFields, planLocationValue } from "./plan-context-model";
import { hasPlanTeamRight } from "./plan-access-model";
import { usePlanTeams } from "./use-plan-teams";
import { useRequestKey } from "./use-plan-management";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { PlanContextValues } from "./plan-context-model";
import type { PlanManagementRequest } from "./use-plan-management";

interface PlanCloneSettings {
  readonly values: PlanContextValues;
  readonly setValues: (values: PlanContextValues) => void;
  readonly teams: ReturnType<typeof usePlanTeams>;
  readonly ownerId: string;
  readonly setOwnerId: (ownerId: string) => void;
  readonly request: PlanManagementRequest;
  readonly key: string;
}

/** Builds a clone request even when name or source workspace needs server repair. */
export function usePlanCloneSettings(
  page: AgentPlanPage,
  source: AgentPlanView,
  isOneShot: boolean,
): PlanCloneSettings {
  const { t } = useTranslation();
  const [values, setValues] = useState(() => ({
    name: isOneShot
      ? suggestOneShotCopyName(
          source.name,
          t("plans.manage.cloneOneShotLabel"),
          new Date(),
        )
      : t("plans.manage.cloneName", { name: source.name }).slice(0, 120),
    projectId: source.projectId,
    location: planLocationValue(source),
  }));
  const teams = usePlanTeams(
    page.directory,
    page.teamDepartmentId
      ? [fullPlanTeam("department", page.teamDepartmentId)]
      : [],
  );
  const [ownerId, setOwnerId] = useState(page.userId);
  const fields = planLocationFields(page, values);
  const request = {
    intent: "clone-plan",
    planId: source.id,
    revision: String(source.revision),
    name: values.name,
    teams: JSON.stringify(teams.teams.filter(hasPlanTeamRight)),
    ...(fields
      ? {
          workspaceId: fields.workspaceId,
          target: fields.executionTarget
            ? JSON.stringify(fields.executionTarget)
            : "",
        }
      : {}),
    ...(ownerId !== page.userId ? { ownerId } : {}),
    ...(isOneShot ? { oneShot: "true" } : {}),
  };
  const key = useRequestKey(JSON.stringify(request));
  return { values, setValues, teams, ownerId, setOwnerId, request, key };
}
