import { fullPlanTeam } from "@/definition/AgentPlanTeam";

import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type {
  AgentPlanTeam,
  AgentPlanTeamKind,
} from "@/definition/AgentPlanTeam";

/** A group or department the Teams dialog can add. */
export interface PlanTeamChoice {
  readonly kind: AgentPlanTeamKind;
  readonly id: string;
  readonly name: string;
}

/** The right a checkbox of a team row changes. */
export type PlanTeamRight = "canRead" | "canEdit" | "canRun";

/** The most search results the dialog offers at once. */
const CHOICE_LIMIT = 8;

/**
 * The name of a team target, or its identifier when the directory no longer knows it.
 *
 * @param directory - The groups and departments of the page.
 * @param team - The team entry.
 */
export function planTeamName(
  directory: AgentProfileDirectory,
  team: Pick<AgentPlanTeam, "kind" | "targetId">,
): string {
  const entries =
    team.kind === "group" ? directory.groups : directory.departments;
  return (
    entries.find((entry) => entry.id === team.targetId)?.name ?? team.targetId
  );
}

/**
 * The groups and departments whose name contains the query and that are no team yet.
 *
 * @param directory - The groups and departments of the page.
 * @param teams - The teams already chosen.
 * @param query - The search text; empty offers the first entries.
 */
export function planTeamChoices(
  directory: AgentProfileDirectory,
  teams: readonly AgentPlanTeam[],
  query: string,
): readonly PlanTeamChoice[] {
  const needle = query.trim().toLocaleLowerCase();
  const taken = new Set(teams.map((team) => `${team.kind}:${team.targetId}`));
  return [
    ...directory.groups.map((entry) => ({ kind: "group" as const, ...entry })),
    ...directory.departments.map((entry) => ({
      kind: "department" as const,
      ...entry,
    })),
  ]
    .filter(
      (choice) =>
        !taken.has(`${choice.kind}:${choice.id}`) &&
        choice.name.toLocaleLowerCase().includes(needle),
    )
    .slice(0, CHOICE_LIMIT);
}

/** Adds a team with all three rights, the default of a new entry. */
export function withPlanTeam(
  teams: readonly AgentPlanTeam[],
  choice: PlanTeamChoice,
): readonly AgentPlanTeam[] {
  return [...teams, fullPlanTeam(choice.kind, choice.id)];
}

/**
 * Changes one right of one team.
 *
 * @remarks
 * Changing or running implies reading, so switching either on switches
 * reading on, and switching reading off switches both off.
 */
export function withPlanTeamRight(
  teams: readonly AgentPlanTeam[],
  index: number,
  change: { readonly right: PlanTeamRight; readonly isOn: boolean },
): readonly AgentPlanTeam[] {
  return teams.map((team, position) => {
    if (position !== index) return team;
    if (change.right === "canRead")
      return change.isOn
        ? { ...team, canRead: true }
        : { ...team, canRead: false, canEdit: false, canRun: false };
    const next: AgentPlanTeam =
      change.right === "canEdit"
        ? { ...team, canEdit: change.isOn }
        : { ...team, canRun: change.isOn };
    return change.isOn ? { ...next, canRead: true } : next;
  });
}

/** Whether a team grants at least one right; one without any is removed on saving. */
export function hasPlanTeamRight(team: AgentPlanTeam): boolean {
  return team.canRead || team.canEdit || team.canRun;
}
