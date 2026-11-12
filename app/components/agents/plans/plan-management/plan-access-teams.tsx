import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";

import { planTeamName, withPlanTeamRight } from "./plan-access-model";

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
      {RIGHTS.map((right) => (
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
