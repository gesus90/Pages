import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  PAGE_AGENT_SHARING_OPERATORS,
  PAGE_AGENT_SHARING_SCOPES,
} from "@/definition/PageAgentOperations";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentParameter } from "@/definition/AgentParameters";
import type {
  PageAgentSharingOperator,
  PageAgentSharingScope,
  PageAgentWriteOperation,
} from "@/definition/PageAgentOperations";

/** Parameters of `agents.list`; the window is validated by the paging helper. */
export interface PageAgentListRequest {
  readonly cursor: unknown;
  readonly limit: unknown;
}

/**
 * A requested share, with the lists of targets in a fixed order.
 *
 * @remarks
 * An omitted operator is not decided here: a new share is `or`, and a change
 * of a restricted share keeps the stored operator, so leaving the field out
 * never widens an `and` share.
 */
export interface PageAgentSharingRequest {
  readonly scope: PageAgentSharingScope;
  readonly operator?: PageAgentSharingOperator;
  readonly groupIds: readonly string[];
  readonly departmentIds: readonly string[];
}

/** The fields a client may set; absent ones are `undefined`. */
export interface PageAgentFields {
  readonly name?: string;
  readonly instruction?: string;
  readonly parameters?: readonly AgentParameter[];
  readonly directoryParameter?: string | null;
  readonly modelProfileId?: string;
  readonly reasoningEffort?: string | null;
  readonly sharing?: PageAgentSharingRequest;
}

export interface PageAgentCreateRequest {
  readonly operation: "agents.create";
  readonly operationId: string;
  readonly fields: PageAgentFields & { readonly name: string };
}

export interface PageAgentUpdateRequest {
  readonly operation: "agents.update";
  readonly operationId: string;
  readonly agentId: string;
  readonly expectedRevision: number;
  readonly fields: PageAgentFields;
}

export type PageAgentWriteRequest =
  PageAgentCreateRequest | PageAgentUpdateRequest;

const EDITABLE_FIELDS = [
  "name",
  "instruction",
  "parameters",
  "directoryParameter",
  "modelProfileId",
  "reasoningEffort",
  "sharing",
] as const;

const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_INSTRUCTION_LENGTH = 200_000;
const MAXIMUM_SHARING_TARGETS = 100;

function invalid(): AgentOperationError {
  return new AgentOperationError("INVALID_REQUEST");
}

function readRevision(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1)
    throw invalid();
  return input;
}

function readName(input: unknown): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > MAXIMUM_NAME_LENGTH
  )
    throw invalid();
  return input.trim();
}

function readInstruction(input: unknown): string {
  if (typeof input !== "string" || input.length > MAXIMUM_INSTRUCTION_LENGTH)
    throw invalid();
  return input;
}

function readEffort(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== "string" || !input.trim() || input.length > 24)
    throw invalid();
  return input;
}

/**
 * Reads the parameter declarations through the rules of a stored agent.
 *
 * @remarks
 * The result carries the names and values in the stored order of keys, so two
 * requests with the same meaning produce the same operation fingerprint.
 */
function readParameters(input: unknown): readonly AgentParameter[] {
  if (!Array.isArray(input) || input.length > 50) throw invalid();
  try {
    return readAgentConfiguration({
      ...emptyAgentConfiguration("person"),
      parameters: input,
    }).parameters;
  } catch (error: unknown) {
    if (error instanceof AgentError)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "configuration_invalid",
      });
    throw error;
  }
}

function readIdentifierList(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length > MAXIMUM_SHARING_TARGETS)
    throw invalid();
  const identifiers = input.map(readIdentifier);
  return [...new Set(identifiers)].sort();
}

function isScope(input: unknown): input is PageAgentSharingScope {
  return PAGE_AGENT_SHARING_SCOPES.some((scope) => scope === input);
}

function isOperator(input: unknown): input is PageAgentSharingOperator {
  return PAGE_AGENT_SHARING_OPERATORS.some((operator) => operator === input);
}

/**
 * Reads a share into its three kinds.
 *
 * @remarks
 * A private or global share names no targets and no operator, so a request
 * that does is refused instead of storing something the interface cannot show.
 * A restricted share needs at least one target, because a restricted share
 * without any looks private in the data.
 */
function readSharing(input: unknown): PageAgentSharingRequest {
  const fields = readParameterRecord(input);
  requireParameterKeys(
    fields,
    ["scope"],
    ["operator", "groupIds", "departmentIds"],
  );
  if (!isScope(fields.scope)) throw invalid();
  const groupIds =
    fields.groupIds === undefined ? [] : readIdentifierList(fields.groupIds);
  const departmentIds =
    fields.departmentIds === undefined
      ? []
      : readIdentifierList(fields.departmentIds);
  if (fields.operator !== undefined && !isOperator(fields.operator))
    throw invalid();
  const isRestricted = fields.scope === "restricted";
  const hasTargets = groupIds.length + departmentIds.length > 0;
  if (isRestricted !== hasTargets) throw invalid();
  if (!isRestricted && fields.operator !== undefined) throw invalid();
  return {
    scope: fields.scope,
    ...(fields.operator === undefined ? {} : { operator: fields.operator }),
    groupIds,
    departmentIds,
  };
}

/** Reads the fields present in `parameters`; absent ones stay absent. */
function readFields(
  parameters: Readonly<Record<string, unknown>>,
): PageAgentFields {
  const fields: Record<string, unknown> = {};
  if ("name" in parameters) fields.name = readName(parameters.name);
  if ("instruction" in parameters)
    fields.instruction = readInstruction(parameters.instruction);
  if ("parameters" in parameters)
    fields.parameters = readParameters(parameters.parameters);
  if ("directoryParameter" in parameters)
    fields.directoryParameter =
      parameters.directoryParameter === null
        ? null
        : readIdentifier(parameters.directoryParameter);
  if ("modelProfileId" in parameters)
    fields.modelProfileId = readIdentifier(parameters.modelProfileId);
  if ("reasoningEffort" in parameters)
    fields.reasoningEffort = readEffort(parameters.reasoningEffort);
  if ("sharing" in parameters) fields.sharing = readSharing(parameters.sharing);
  return fields;
}

/**
 * Reads the parameters of `agents.list`.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for an unknown parameter.
 */
export function readPageAgentListRequest(input: unknown): PageAgentListRequest {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, [], ["cursor", "limit"]);
  return { cursor: parameters.cursor, limit: parameters.limit };
}

/**
 * Reads the identifier of the agent that `agents.read` names.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing or unknown parameter.
 */
export function readPageAgentReadRequest(input: unknown): string {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, ["agentId"]);
  return readIdentifier(parameters.agentId);
}

/**
 * Checks that `agents.models.list` takes no parameter.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for any parameter.
 */
export function requirePageAgentModelsRequest(input: unknown): void {
  requireParameterKeys(readParameterRecord(input), []);
}

/**
 * Reads a create or update call into one typed request.
 *
 * @param operation - The write operation that was called.
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or
 * malformed parameter; an owner or user parameter is unknown like any other.
 *
 * @remarks
 * The checks here are the shape of the call. Pages judges the content of a
 * definition itself when it is saved, so a client sees the refusals of the
 * interface.
 */
export function readPageAgentWriteRequest(
  operation: PageAgentWriteOperation,
  input: unknown,
): PageAgentWriteRequest {
  const parameters = readParameterRecord(input);
  if (operation === "agents.create") {
    requireParameterKeys(
      parameters,
      ["operationId", "name"],
      EDITABLE_FIELDS.filter((field) => field !== "name"),
    );
    const fields = readFields(parameters);
    return {
      operation,
      operationId: readIdentifier(parameters.operationId),
      fields: { ...fields, name: readName(parameters.name) },
    };
  }
  requireParameterKeys(
    parameters,
    ["operationId", "agentId", "expectedRevision"],
    EDITABLE_FIELDS,
  );
  const fields = readFields(parameters);
  if (Object.keys(fields).length === 0) throw invalid();
  return {
    operation,
    operationId: readIdentifier(parameters.operationId),
    agentId: readIdentifier(parameters.agentId),
    expectedRevision: readRevision(parameters.expectedRevision),
    fields,
  };
}
