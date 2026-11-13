import { useState } from "react";

import { planTeamChoices, withPlanTeam } from "./plan-access-model";

import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";
import type { PlanTeamChoice } from "./plan-access-model";

/** The shared controlled team list and its search state, initialized from the server's defaults or saved teams. */
export function usePlanTeams(
  directory: AgentProfileDirectory,
  initial: readonly AgentPlanTeam[],
): {
  readonly teams: readonly AgentPlanTeam[];
  readonly setTeams: (teams: readonly AgentPlanTeam[]) => void;
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly choices: readonly PlanTeamChoice[];
  readonly add: (choice: PlanTeamChoice) => void;
} {
  const [teams, setTeams] = useState(initial);
  const [query, setQuery] = useState("");
  return {
    teams,
    setTeams,
    query,
    setQuery,
    choices: planTeamChoices(directory, teams, query),
    add: (choice) => {
      setTeams(withPlanTeam(teams, choice));
      setQuery("");
    },
  };
}
