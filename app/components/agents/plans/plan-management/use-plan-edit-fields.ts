import { usePlanRevisionState } from "../use-plan-revision-state";
import { planLocationValue } from "./plan-context-model";
import { usePlanOneShotChoice } from "./plan-one-shot-field";
import { usePlanTeams } from "./use-plan-teams";

import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { PlanContextValues } from "./plan-context-model";

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

/** Follows pristine settings while preserving the base revision of local dialog edits. */
export function usePlanEditFields(
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
