import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";

import { planTeamName, withPlanTeamRight } from "./plan-access-model";

import type { usePlanTeams } from "./use-plan-teams";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { PlanTeamChoice } from "./plan-access-model";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";
import type { PlanTeamRight } from "./plan-access-model";

const RIGHTS: readonly PlanTeamRight[] = ["canRead", "canEdit", "canRun"];

/**
 * The teams of the plan, one row each, with the rights read, change and run.
 *
 * @remarks
 * Changing or running implies reading; the checkboxes follow that rule. A
 * team the directory no longer knows keeps its identifier as its name, so it
 * can still be removed.
 */
export function PlanTeamRows(props: {
  readonly directory: AgentProfileDirectory;
  readonly teams: readonly AgentPlanTeam[];
  readonly isDisabled: boolean;
  readonly onChange: (teams: readonly AgentPlanTeam[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.teams.length === 0)
    return (
      <p className="text-xs text-muted-foreground" data-plan-teams-empty>
        {t("plans.access.noTeams")}
      </p>
    );
  return (
    <div className="space-y-2">
      <ul className="space-y-2" data-plan-teams>
        {props.teams.map((team, index) => (
          <PlanTeamRow
            key={`${team.kind}:${team.targetId}`}
            name={planTeamName(props.directory, team)}
            team={team}
            isDisabled={props.isDisabled}
            onRight={(right, isOn) =>
              props.onChange(
                withPlanTeamRight(props.teams, index, { right, isOn }),
              )
            }
            onRemove={() =>
              props.onChange(
                props.teams.filter((_, position) => position !== index),
              )
            }
          />
        ))}
      </ul>
      {props.teams.some((team) => team.kind === "user") ? (
        <p className="text-xs text-muted-foreground">
          {t("plans.access.personReadOnly")}
        </p>
      ) : null}
    </div>
  );
}

function PlanTeamRow(props: {
  readonly name: string;
  readonly team: AgentPlanTeam;
  readonly isDisabled: boolean;
  readonly onRight: (right: PlanTeamRight, isOn: boolean) => void;
  readonly onRemove: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-muted px-3 py-2"
      data-plan-team={props.name}
    >
      <span className="min-w-0 flex-1 basis-40 text-xs">
        <span className="font-semibold wrap-anywhere">{props.name}</span>
        <span className="ml-1.5 text-muted-foreground">
          {t(`plans.access.kind.${props.team.kind}`)}
        </span>
      </span>
      {RIGHTS.filter(
        (right) => props.team.kind !== "user" || right === "canRead",
      ).map((right) => (
        <label
          key={right}
          className="flex items-center gap-1.5 text-xs [@media(pointer:coarse)]:min-h-11"
        >
          <Checkbox
            checked={props.team[right]}
            disabled={props.isDisabled}
            onChange={(event) => props.onRight(right, event.target.checked)}
            data-plan-team-right={right}
          />
          {t(`plans.access.right.${right}`)}
        </label>
      ))}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={props.isDisabled}
        aria-label={t("plans.access.remove", { name: props.name })}
        onClick={props.onRemove}
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </li>
  );
}

/** The search for groups and departments and the matching entries to add. */
export function PlanTeamSearch(props: {
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
export function PlanOwnerField(props: {
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

/** The same search and rows in the two compact settings disclosures. */
export function PlanSettingsTeams(props: {
  readonly directory: AgentProfileDirectory;
  readonly state: ReturnType<typeof usePlanTeams>;
  readonly isDisabled: boolean;
  readonly canManage: boolean;
  readonly searchId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { state } = props;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t("plans.access.teams")}</h3>
      {props.canManage && !props.isDisabled ? (
        <PlanTeamSearch
          id={props.searchId}
          query={state.query}
          choices={state.choices}
          onQuery={state.setQuery}
          onAdd={state.add}
        />
      ) : null}
      <PlanTeamRows
        directory={props.directory}
        teams={state.teams}
        onChange={state.setTeams}
        isDisabled={props.isDisabled || !props.canManage}
      />
    </section>
  );
}
