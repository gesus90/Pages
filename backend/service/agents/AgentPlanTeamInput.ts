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
  requireParameterKeys(team, ["kind", "id"], ["read", "edit", "run"]);
  if (!isAgentPlanTeamKind(team.kind))
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    kind: team.kind,
    targetId: readIdentifier(team.id),
    canRead: readRight(team.read),
    canEdit: readRight(team.edit),
    canRun: readRight(team.run),
  };
}

/**
 * Reads the `teams` parameter of `update_plan` (PAGE-329).
 *
 * @param input - The raw parameter: a list of `{kind, id, read?, edit?, run?}`;
 * an omitted right defaults to `true`.
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
