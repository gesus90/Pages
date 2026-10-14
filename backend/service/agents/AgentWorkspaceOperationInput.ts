import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentWorkspaceWriteOperation } from "@/definition/AgentWorkspaceOperations";

/** Parameters of `workspaces.list`; the window is validated by the paging helper. */
export interface WorkspaceListRequest {
  readonly projectId: string | null;
  readonly cursor: unknown;
  readonly limit: unknown;
}

/** The text fields reach the registration rules as they were sent, so one rule judges them. */
export interface WorkspaceCreateRequest {
  readonly operation: "workspaces.create";
  readonly operationId: string;
  readonly name: unknown;
  readonly path: unknown;
  readonly projectId: unknown;
}

/** The fields a client may change; absent ones keep their stored value. */
export interface WorkspaceUpdateRequest {
  readonly operation: "workspaces.update";
  readonly operationId: string;
  readonly workspaceId: string;
  readonly expectedRevision: number;
  readonly changes: Readonly<Record<string, unknown>>;
}

export interface WorkspaceRemoveRequest {
  readonly operation: "workspaces.remove";
  readonly operationId: string;
  readonly workspaceId: string;
  readonly expectedRevision: number;
}

export type WorkspaceWriteRequest =
  WorkspaceCreateRequest | WorkspaceUpdateRequest | WorkspaceRemoveRequest;

const EDITABLE_FIELDS = ["name", "path", "projectId"] as const;

function readRevision(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1)
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

/**
 * Reads the parameters of `workspaces.list`.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for an unknown parameter.
 */
export function readWorkspaceListRequest(input: unknown): WorkspaceListRequest {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, [], ["projectId", "cursor", "limit"]);
  return {
    projectId:
      parameters.projectId === undefined
        ? null
        : readIdentifier(parameters.projectId),
    cursor: parameters.cursor,
    limit: parameters.limit,
  };
}

/**
 * Reads the identifier of the workspace that `workspaces.read` names.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing or unknown parameter.
 */
export function readWorkspaceReadRequest(input: unknown): string {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, ["workspaceId"]);
  return readIdentifier(parameters.workspaceId);
}

/**
 * Reads a create, update or remove call into one typed request.
 *
 * @param operation - The write operation that was called.
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 *
 * @remarks
 * Text fields are only checked for presence here; the registration rules judge
 * their content, so a client sees the same refusals as the interface gives.
 */
export function readWorkspaceWriteRequest(
  operation: AgentWorkspaceWriteOperation,
  input: unknown,
): WorkspaceWriteRequest {
  const parameters = readParameterRecord(input);
  if (operation === "workspaces.create") {
    requireParameterKeys(parameters, [
      "operationId",
      "name",
      "path",
      "projectId",
    ]);
    return {
      operation,
      operationId: readIdentifier(parameters.operationId),
      name: parameters.name,
      path: parameters.path,
      projectId: parameters.projectId,
    };
  }
  if (operation === "workspaces.remove") {
    requireParameterKeys(parameters, [
      "operationId",
      "workspaceId",
      "expectedRevision",
    ]);
    return {
      operation,
      operationId: readIdentifier(parameters.operationId),
      workspaceId: readIdentifier(parameters.workspaceId),
      expectedRevision: readRevision(parameters.expectedRevision),
    };
  }
  requireParameterKeys(
    parameters,
    ["operationId", "workspaceId", "expectedRevision"],
    EDITABLE_FIELDS,
  );
  const changes = Object.fromEntries(
    EDITABLE_FIELDS.filter((field) => field in parameters).map((field) => [
      field,
      parameters[field],
    ]),
  );
  if (Object.keys(changes).length === 0)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operation,
    operationId: readIdentifier(parameters.operationId),
    workspaceId: readIdentifier(parameters.workspaceId),
    expectedRevision: readRevision(parameters.expectedRevision),
    changes,
  };
}
