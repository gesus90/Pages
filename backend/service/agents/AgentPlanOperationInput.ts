import {
  PLAN_NODE_FIELDS,
  PLAN_ADDABLE_TYPES,
} from "@/definition/AgentPlanChangeFields";
import { readPlanBinding } from "@/backend/agents/AgentPlanInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { readPlanGroupChange } from "./AgentPlanGroupChangeInput";
import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import {
  readPageAgentRevision,
  readPageAgentSharing,
} from "./PageAgentOperationInput";

import type { AgentPlanBinding, AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanWriteOperation } from "@/definition/AgentPlanOperations";
import type { PageAgentSharingRequest } from "./PageAgentOperationInput";

/** Changes one call may carry; a plan holds at most 100 nodes and 500 connections. */
const MAXIMUM_CHANGES = 200;
const MAXIMUM_NAME_LENGTH = 120;
const MAXIMUM_TEXT_FILTER_LENGTH = 200;

/** Node fields a change may set, by the kind of node; positions are always settable. */
export const AGENT_PLAN_NODE_FIELDS: Readonly<
  Record<AgentPlanNode["type"], readonly string[]>
> = PLAN_NODE_FIELDS;
const ADDABLE_TYPES = PLAN_ADDABLE_TYPES;
const POSITION_FIELDS = ["x", "y"];

/** One change of the structure of a plan, applied in the order given. */
export type AgentPlanChange =
  | {
      readonly action: "addNode";
      readonly type: (typeof ADDABLE_TYPES)[number];
      /** The identifier the client chose, so later changes of the call can name the node. */
      readonly id: string | null;
      /** The raw node fields; the node is parsed like the plan page's when it is built. */
      readonly fields: Readonly<Record<string, unknown>>;
    }
  | {
      readonly action: "updateNode";
      readonly nodeId: string;
      readonly fields: Readonly<Record<string, unknown>>;
    }
  | {
      readonly action: "placeNode" | "placeLoopNode";
      readonly nodeId: string;
      readonly groupId: string | null;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly action: "ungroup";
      readonly nodeId: string;
      readonly positions: readonly {
        readonly nodeId: string;
        readonly x: number;
        readonly y: number;
      }[];
    }
  | {
      readonly action: "insertTemplate";
      readonly templateId: string;
      readonly x: number;
      readonly y: number;
    }
  | { readonly action: "removeNode"; readonly nodeId: string }
  | { readonly action: "connect"; readonly from: string; readonly to: string }
  | {
      readonly action: "disconnect";
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly action: "bind";
      readonly nodeId: string;
      readonly parameter: string;
      readonly binding: AgentPlanBinding;
    }
  | {
      readonly action: "unbind";
      readonly nodeId: string;
      readonly parameter: string;
    };

/** A list window, validated by the paging helper. */
export interface AgentPlanWindow {
  readonly cursor: unknown;
  readonly limit: unknown;
}

export interface AgentPlanListRequest extends AgentPlanWindow {
  readonly text: string | null;
  readonly projectId: string | null;
}

export interface AgentPlanRunsRequest extends AgentPlanWindow {
  readonly planId: string;
  readonly order: "newest" | "oldest";
}

/** A run named by its identifier, or as the newest or the first run of a plan. */
export type AgentPlanRunSelection =
  | { readonly runId: string; readonly planId: string | null }
  | { readonly planId: string; readonly select: "latest" | "first" };

export interface AgentPlanReportsRequest {
  readonly run: AgentPlanRunSelection;
  readonly stepId: string | null;
}

/** What every change of an existing plan names: the plan and the revision read last. */
interface AgentPlanTarget {
  readonly operationId: string;
  readonly planId: string;
  readonly expectedRevision: number;
}

export interface AgentPlanCreateRequest {
  readonly operation: "plans.create";
  readonly operationId: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly sharing: PageAgentSharingRequest | null;
  readonly changes: readonly AgentPlanChange[];
}

/** An update, or a parameter operation expressed as the change it makes. */
export interface AgentPlanUpdateRequest extends AgentPlanTarget {
  readonly operation: Exclude<AgentPlanWriteOperation, "plans.create">;
  readonly name: string | null;
  readonly sharing: PageAgentSharingRequest | null;
  /** The workspace to move the plan to; absent or `null` keeps the current one. */
  readonly workspaceId?: string | null;
  readonly changes: readonly AgentPlanChange[];
  /** The parameter node a parameter operation must find, `null` otherwise. */
  readonly parameterId: string | null;
}

export type AgentPlanWriteRequest =
  AgentPlanCreateRequest | AgentPlanUpdateRequest;

function invalid(): AgentOperationError {
  return new AgentOperationError("INVALID_REQUEST");
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

function readOptionalIdentifier(input: unknown): string | null {
  return input === undefined ? null : readIdentifier(input);
}

function readNodeType(input: unknown): (typeof ADDABLE_TYPES)[number] {
  const type = ADDABLE_TYPES.find((entry) => entry === input);
  if (type === undefined) throw invalid();
  return type;
}

function readAddNode(
  change: Readonly<Record<string, unknown>>,
): AgentPlanChange {
  requireParameterKeys(change, ["action", "node"]);
  const node = readParameterRecord(change.node);
  const type = readNodeType(node.type);
  requireParameterKeys(
    node,
    ["type"],
    ["id", ...POSITION_FIELDS, ...AGENT_PLAN_NODE_FIELDS[type]],
  );
  return {
    action: "addNode",
    type,
    id: readOptionalIdentifier(node.id),
    fields: Object.fromEntries(
      Object.entries(node).filter(([key]) => key !== "type" && key !== "id"),
    ),
  };
}

function readUpdateNode(
  change: Readonly<Record<string, unknown>>,
): AgentPlanChange {
  requireParameterKeys(change, ["action", "nodeId", "fields"]);
  const fields = readParameterRecord(change.fields);
  const allowed = new Set([
    ...POSITION_FIELDS,
    ...Object.values(AGENT_PLAN_NODE_FIELDS).flat(),
  ]);
  if (
    Object.keys(fields).length === 0 ||
    Object.keys(fields).some((key) => !allowed.has(key))
  )
    throw invalid();
  return {
    action: "updateNode",
    nodeId: readIdentifier(change.nodeId),
    fields,
  };
}

function readConnection(
  change: Readonly<Record<string, unknown>>,
  action: "connect" | "disconnect",
): AgentPlanChange {
  requireParameterKeys(change, ["action", "from", "to"]);
  return {
    action,
    from: readIdentifier(change.from),
    to: readIdentifier(change.to),
  };
}

function readInputChange(
  change: Readonly<Record<string, unknown>>,
  action: "bind" | "unbind",
): AgentPlanChange {
  if (action === "unbind") {
    requireParameterKeys(change, ["action", "nodeId", "parameter"]);
    return {
      action,
      nodeId: readIdentifier(change.nodeId),
      parameter: readIdentifier(change.parameter),
    };
  }
  requireParameterKeys(change, ["action", "nodeId", "parameter", "binding"]);
  return {
    action,
    nodeId: readIdentifier(change.nodeId),
    parameter: readIdentifier(change.parameter),
    // The plan's own reader decides what a binding may hold.
    binding: readPlanBinding(change.binding),
  };
}

function readChange(input: unknown): AgentPlanChange {
  const change = readParameterRecord(input);
  const { action } = change;
  if (
    action === "placeNode" ||
    action === "placeLoopNode" ||
    action === "ungroup" ||
    action === "insertTemplate"
  )
    return readPlanGroupChange(change);
  if (action === "addNode") return readAddNode(change);
  if (action === "updateNode") return readUpdateNode(change);
  if (action === "removeNode") {
    requireParameterKeys(change, ["action", "nodeId"]);
    return { action, nodeId: readIdentifier(change.nodeId) };
  }
  if (action === "connect" || action === "disconnect")
    return readConnection(change, action);
  if (action === "bind" || action === "unbind")
    return readInputChange(change, action);
  throw invalid();
}

function readChanges(input: unknown): readonly AgentPlanChange[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAXIMUM_CHANGES) throw invalid();
  return input.map(readChange);
}

function readWindow(
  parameters: Readonly<Record<string, unknown>>,
): AgentPlanWindow {
  return { cursor: parameters.cursor, limit: parameters.limit };
}

/**
 * Reads `plans.list`: an optional part of the name, an optional project and the window.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readPlanListRequest(input: unknown): AgentPlanListRequest {
  const parameters = readParameterRecord(input);
  requireParameterKeys(
    parameters,
    [],
    ["text", "projectId", "cursor", "limit"],
  );
  const { text } = parameters;
  if (
    text !== undefined &&
    (typeof text !== "string" ||
      !text.trim() ||
      text.length > MAXIMUM_TEXT_FILTER_LENGTH)
  )
    throw invalid();
  return {
    text: text === undefined ? null : text.trim(),
    projectId: readOptionalIdentifier(parameters.projectId),
    ...readWindow(parameters),
  };
}

/**
 * Reads `plans.read`: the plan to read.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readPlanReadRequest(input: unknown): string {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, ["planId"]);
  return readIdentifier(parameters.planId);
}

/**
 * Reads `plans.sources.read`: optionally the workspace whose agents to list.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for an unknown or malformed parameter.
 */
export function readPlanSourcesRequest(input: unknown): string | null {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, [], ["workspaceId"]);
  return readOptionalIdentifier(parameters.workspaceId);
}

/**
 * Reads `plans.runs.list`: the plan, the order of the starts and the window.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readPlanRunsRequest(input: unknown): AgentPlanRunsRequest {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, ["planId"], ["order", "cursor", "limit"]);
  const { order } = parameters;
  if (order !== undefined && order !== "newest" && order !== "oldest")
    throw invalid();
  return {
    planId: readIdentifier(parameters.planId),
    order: order ?? "newest",
    ...readWindow(parameters),
  };
}

function readRunSelection(
  parameters: Readonly<Record<string, unknown>>,
): AgentPlanRunSelection {
  if (parameters.runId !== undefined) {
    if (parameters.select !== undefined) throw invalid();
    return {
      runId: readIdentifier(parameters.runId),
      planId: readOptionalIdentifier(parameters.planId),
    };
  }
  const { select } = parameters;
  if (select !== "latest" && select !== "first") throw invalid();
  return { planId: readIdentifier(parameters.planId), select };
}

/**
 * Reads `plans.run.read`: a run identifier, or a plan with `latest` or `first`.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readPlanRunRequest(input: unknown): AgentPlanRunSelection {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, [], ["runId", "planId", "select"]);
  return readRunSelection(parameters);
}

/**
 * Reads `plans.run.reports.read`: the run as in `plans.run.read`, and optionally one node.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readPlanReportsRequest(
  input: unknown,
): AgentPlanReportsRequest {
  const parameters = readParameterRecord(input);
  requireParameterKeys(parameters, [], ["runId", "planId", "select", "stepId"]);
  return {
    run: readRunSelection(parameters),
    stepId: readOptionalIdentifier(parameters.stepId),
  };
}

function readSharing(input: unknown): PageAgentSharingRequest | null {
  return input === undefined ? null : readPageAgentSharing(input);
}

function readTarget(
  parameters: Readonly<Record<string, unknown>>,
): AgentPlanTarget {
  return {
    operationId: readIdentifier(parameters.operationId),
    planId: readIdentifier(parameters.planId),
    expectedRevision: readPageAgentRevision(parameters.expectedRevision),
  };
}

function readParameterFields(
  parameters: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      parameters[key] === undefined ? [] : [[key, parameters[key]]],
    ),
  );
}

const TARGET_KEYS = ["operationId", "planId", "expectedRevision"];
const PARAMETER_KEYS = ["name", "format", "value", ...POSITION_FIELDS];

function readParameterWrite(
  operation: Exclude<AgentPlanWriteOperation, "plans.create" | "plans.update">,
  parameters: Readonly<Record<string, unknown>>,
): AgentPlanUpdateRequest {
  const base = { operation, name: null, sharing: null };
  if (operation === "plans.parameter.create") {
    requireParameterKeys(
      parameters,
      [...TARGET_KEYS, "name", "value"],
      ["format", ...POSITION_FIELDS],
    );
    const fields = readParameterFields(parameters, PARAMETER_KEYS);
    return {
      ...base,
      ...readTarget(parameters),
      parameterId: null,
      changes: [{ action: "addNode", type: "parameter", id: null, fields }],
    };
  }
  const parameterKeys = [...TARGET_KEYS, "parameterId"];
  const isRemoval = operation === "plans.parameter.remove";
  requireParameterKeys(
    parameters,
    parameterKeys,
    isRemoval ? [] : PARAMETER_KEYS,
  );
  const parameterId = readIdentifier(parameters.parameterId);
  const fields = readParameterFields(parameters, PARAMETER_KEYS);
  if (!isRemoval && Object.keys(fields).length === 0) throw invalid();
  return {
    ...base,
    ...readTarget(parameters),
    parameterId,
    changes: isRemoval
      ? [{ action: "removeNode", nodeId: parameterId }]
      : [{ action: "updateNode", nodeId: parameterId, fields }],
  };
}

/**
 * Reads a change of plans into one typed request.
 *
 * @param operation - The write operation that was called.
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 *
 * @remarks
 * The checks here are the shape of the call. Pages judges the plan itself when
 * it is saved, with the graph check of the plan page.
 */
export function readPlanWriteRequest(
  operation: AgentPlanWriteOperation,
  input: unknown,
): AgentPlanWriteRequest {
  const parameters = readParameterRecord(input);
  if (operation === "plans.create") {
    requireParameterKeys(
      parameters,
      ["operationId", "name", "workspaceId"],
      ["sharing", "changes"],
    );
    return {
      operation,
      operationId: readIdentifier(parameters.operationId),
      name: readName(parameters.name),
      workspaceId: readIdentifier(parameters.workspaceId),
      sharing: readSharing(parameters.sharing),
      changes: readChanges(parameters.changes),
    };
  }
  if (operation !== "plans.update")
    return readParameterWrite(operation, parameters);
  requireParameterKeys(parameters, TARGET_KEYS, [
    "name",
    "sharing",
    "workspaceId",
    "changes",
  ]);
  const request: AgentPlanUpdateRequest = {
    operation,
    ...readTarget(parameters),
    name: parameters.name === undefined ? null : readName(parameters.name),
    sharing: readSharing(parameters.sharing),
    workspaceId: readOptionalIdentifier(parameters.workspaceId),
    changes: readChanges(parameters.changes),
    parameterId: null,
  };
  if (
    request.name === null &&
    request.sharing === null &&
    request.workspaceId === null &&
    request.changes.length === 0
  )
    throw invalid();
  return request;
}
