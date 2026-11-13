import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  AGENT_PLAN_TEAM_LIMIT,
  isAgentPlanTeamKind,
} from "@/definition/AgentPlanTeam";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";

function readRight(input: unknown): boolean {
  if (input === undefined) return true;
  if (typeof input !== "boolean")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function readTeam(input: unknown): AgentPlanTeam {
  const team = readParameterRecord(input);
  const isCanonical = "targetId" in team;
  requireParameterKeys(
    team,
    isCanonical
      ? ["kind", "targetId", "canRead", "canEdit", "canRun"]
      : ["kind", "id"],
    isCanonical ? [] : ["read", "edit", "run"],
  );
  if (!isAgentPlanTeamKind(team.kind))
    throw new AgentOperationError("INVALID_REQUEST");
  const canEdit = isCanonical ? team.canEdit : team.edit;
  const canRun = isCanonical ? team.canRun : team.run;
  return {
    kind: team.kind,
    targetId: readIdentifier(isCanonical ? team.targetId : team.id),
    canRead: readRight(isCanonical ? team.canRead : team.read),
    canEdit:
      canEdit === undefined && team.kind === "user"
        ? false
        : readRight(canEdit),
    canRun:
      canRun === undefined && team.kind === "user" ? false : readRight(canRun),
  };
}

/**
 * Reads the shared `teams` parameter of `update_plan` and `clone_plan`.
 *
 * @param input - Canonical `{kind, targetId, canRead, canEdit, canRun}` entries,
 * or legacy `{kind, id, read?, edit?, run?}`. Legacy rights default to true,
 * except a person's edit and run rights, which default to false.
 * @returns The entries in their order, or `undefined` when the parameter is absent.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a malformed entry or too many entries.
 */
export function readPlanTeamsParameter(
  input: unknown,
): readonly AgentPlanTeam[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > AGENT_PLAN_TEAM_LIMIT)
    throw new AgentOperationError("INVALID_REQUEST");
  return input.map(readTeam);
}

/**
 * Reads the `ownerId` parameter of `update_plan` (PAGE-329).
 *
 * @returns The new owner, or `undefined` when the parameter is absent.
 */
export function readPlanOwnerParameter(input: unknown): string | undefined {
  return input === undefined ? undefined : readIdentifier(input);
}
