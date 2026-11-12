import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import { planRequestError } from "./plan-context-model";
import { PlanDialogFrame } from "./plan-dialog-frame";
import { PlanTeamRows } from "./plan-access-teams";
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

/** The search for groups and departments and the matching entries to add. */
function PlanTeamSearch(props: {
  readonly id: string;
  readonly query: string;
  readonly choices: readonly PlanTeamChoice[];
  readonly onQuery: (query: string) => void;
  readonly onAdd: (choice: PlanTeamChoice) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <label
        htmlFor={`${props.id}-search`}
        className="grid gap-1.5 text-xs font-medium"
      >
        {t("plans.access.search")}
        <Input
          id={`${props.id}-search`}
          value={props.query}
          placeholder={t("plans.access.searchPlaceholder")}
          onChange={(event) => props.onQuery(event.target.value)}
          data-plan-team-search
        />
      </label>
      {props.choices.length > 0 ? (
        <ul
          className="flex flex-wrap gap-1.5"
          aria-label={t("plans.access.choices")}
        >
          {props.choices.map((choice) => (
            <li key={`${choice.kind}:${choice.id}`}>
              <button
                type="button"
                className="rounded-full border border-control-border px-2.5 py-1 text-xs hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
                onClick={() => props.onAdd(choice)}
                data-plan-team-choice={choice.name}
              >
                {t("plans.access.add", {
                  name: choice.name,
                  kind: t(`plans.access.kind.${choice.kind}`),
                })}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("plans.access.noChoices")}
        </p>
      )}
    </div>
  );
}

/** The owner choice of an administrator: every active account. */
function PlanOwnerField(props: {
  readonly page: AgentPlanPage;
  readonly ownerId: string;
  readonly isDisabled: boolean;
  readonly onChange: (ownerId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const persons = props.page.directory.persons;
  const options = persons.some((person) => person.id === props.ownerId)
    ? persons
    : [{ id: props.ownerId, name: props.ownerId }, ...persons];
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {t("plans.access.owner")}
      <Select
        ariaLabel={t("plans.access.owner")}
        value={props.ownerId}
        disabled={props.isDisabled}
        options={options.map((person) => ({
          value: person.id,
          label: person.name,
        }))}
        onValueChange={props.onChange}
        className="w-full min-w-0 [&>span]:truncate"
      />
      <span className="font-normal text-muted-foreground">
        {t("plans.access.ownerHint")}
      </span>
    </label>
  );
}
