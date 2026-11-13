import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { planRequestError } from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";
import {
  PlanTeamRows,
  PlanTeamSearch,
  PlanOwnerField,
} from "./plan-access-teams";
import {
  hasPlanTeamRight,
  planTeamChoices,
  withPlanTeam,
} from "./plan-access-model";
import { useRequestKey } from "./use-plan-management";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";
import type { PlanTeamChoice } from "./plan-access-model";
import type { usePlanManagement } from "./use-plan-management";

/** The request of the dialog: the complete team list and, for administrators, the owner. */
function accessRequest(
  plan: AgentPlanView,
  change: {
    readonly teams: readonly AgentPlanTeam[];
    readonly ownerId: string;
    readonly canManageTeams: boolean;
  },
): Readonly<Record<string, string>> {
  return {
    intent: "plan-access",
    planId: plan.id,
    revision: String(plan.revision),
    ...(change.canManageTeams
      ? { teams: JSON.stringify(change.teams.filter(hasPlanTeamRight)) }
      : {}),
    ...(change.ownerId === plan.ownerId ? {} : { ownerId: change.ownerId }),
  };
}

/**
 * Teams and owner of the plan (PAGE-329): who reads, changes and runs it.
 *
 * @remarks
 * The owner, administrators and project managers search groups and
 * departments, add them as teams and tick the rights read, change and run;
 * a new team has all three. Only an administrator changes the owner. Saving
 * stores one revision of its own; the editor's unsaved graph is not touched.
 */
export function PlanAccessDialog({
  page,
  plan,
  management,
}: {
  readonly page: AgentPlanPage;
  readonly plan: AgentPlanView;
  readonly management: ReturnType<typeof usePlanManagement>;
}): React.ReactElement {
  const { t } = useTranslation();
  const searchId = useId();
  const [teams, setTeams] = useState<readonly AgentPlanTeam[]>(
    plan.teams ?? [],
  );
  const [ownerId, setOwnerId] = useState(plan.ownerId);
  const [query, setQuery] = useState("");
  const canManageTeams = plan.rights?.canManageTeams === true;
  const canChangeOwner = plan.rights?.canChangeOwner === true;
  const request = accessRequest(plan, { teams, ownerId, canManageTeams });
  const key = useRequestKey(JSON.stringify(request));
  const choices = canManageTeams
    ? planTeamChoices(page.directory, teams, query)
    : [];
  function add(choice: PlanTeamChoice): void {
    setTeams(withPlanTeam(teams, choice));
    setQuery("");
  }
  return (
    <PlanDialogFrame
      title={t("plans.access.title")}
      description={t("plans.access.description", { name: plan.name })}
      submitLabel={t("plans.execution.save")}
      isPending={management.isPending}
      isSubmitDisabled={!canManageTeams && !canChangeOwner}
      error={planRequestError(management.error, t)}
      onSubmit={() => management.submit(request, key)}
      onClose={management.close}
    >
      <section className="space-y-3" aria-labelledby={`${searchId}-title`}>
        <h3 id={`${searchId}-title`} className="text-xs font-semibold">
          {t("plans.access.teams")}
        </h3>
        <PlanTeamRows
          directory={page.directory}
          teams={teams}
          isDisabled={!canManageTeams || management.isPending}
          onChange={setTeams}
        />
        {canManageTeams ? (
          <PlanTeamSearch
            id={searchId}
            query={query}
            choices={choices}
            onQuery={setQuery}
            onAdd={add}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("plans.access.teamsReadOnly")}
          </p>
        )}
      </section>
      {canChangeOwner ? (
        <PlanOwnerField
          page={page}
          ownerId={ownerId}
          isDisabled={management.isPending}
          onChange={setOwnerId}
        />
      ) : null}
    </PlanDialogFrame>
  );
}
