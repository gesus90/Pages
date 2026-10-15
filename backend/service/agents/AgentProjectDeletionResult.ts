import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  hasAllCounts,
  PROJECT_DELETION_COUNT_KEYS,
  PROJECT_DELETION_DETACHMENT_KEYS,
} from "@/definition/AgentProjectDeletion";

import { readIdentifier, readParameterRecord } from "./AgentParameterReader";

import type { AgentAdminChanged } from "@/definition/AgentAdministration";
import type {
  ProjectDeletionScope,
  ProjectDeletionTarget,
} from "@/definition/AgentProjectDeletion";
import type { ProjectDeletionOutcome } from "@/backend/service/project/ProjectDeletionService";

function readCounts<Key extends string>(
  keys: readonly Key[],
  input: unknown,
): Record<Key, number> {
  const record = readParameterRecord(input);
  const counts: Partial<Record<Key, number>> = {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new AgentOperationError("INVALID_REQUEST");
    counts[key] = value;
  }
  if (!hasAllCounts(keys, counts))
    throw new AgentOperationError("INVALID_REQUEST");
  return counts;
}

function readTarget(input: unknown): ProjectDeletionTarget {
  const project = readParameterRecord(input);
  const { departmentNames, isArchived, name, status } = project;
  if (
    typeof name !== "string" ||
    typeof status !== "string" ||
    typeof isArchived !== "boolean" ||
    !Array.isArray(departmentNames) ||
    departmentNames.some((entry) => typeof entry !== "string")
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    id: readIdentifier(project.id),
    name,
    status,
    isArchived,
    departmentNames: departmentNames.filter(
      (entry): entry is string => typeof entry === "string",
    ),
  };
}

/** Narrows the scope of a saved result instead of trusting replay JSON as a type. */
function readScope(input: unknown): ProjectDeletionScope {
  const scope = readParameterRecord(input);
  return {
    project: readTarget(scope.project),
    counts: readCounts(PROJECT_DELETION_COUNT_KEYS, scope.counts),
    detached: readCounts(PROJECT_DELETION_DETACHMENT_KEYS, scope.detached),
  };
}

/**
 * Builds the public result of a completed project deletion.
 *
 * @param outcome - What the deleting transaction removed.
 * @returns The result that is stored for replay, audited, and returned.
 */
export function projectDeletionResult(
  outcome: ProjectDeletionOutcome,
): AgentAdminChanged {
  return {
    id: outcome.scope.project.id,
    targetType: "project",
    changed: true,
    affectedUserIds: outcome.memberIds,
    deleted: outcome.scope,
  };
}

/**
 * Narrows a stored project deletion result before it is returned again.
 *
 * @param json - The text saved with the operation ID.
 * @returns The same result the first call returned.
 * @throws {AgentOperationError} `INVALID_REQUEST` when the text is not such a result.
 */
export function readStoredProjectDeletion(json: string): AgentAdminChanged {
  const parsed: unknown = JSON.parse(json);
  const stored = readParameterRecord(parsed);
  const { affectedUserIds } = stored;
  if (
    stored.targetType !== "project" ||
    stored.changed !== true ||
    !Array.isArray(affectedUserIds)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    id: readIdentifier(stored.id),
    targetType: "project",
    changed: true,
    affectedUserIds: affectedUserIds.map(readIdentifier),
    deleted: readScope(stored.deleted),
  };
}
