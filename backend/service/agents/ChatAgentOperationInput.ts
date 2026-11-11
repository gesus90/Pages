import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import {
  PAGE_AGENT_EDITABLE_FIELDS,
  readPageAgentFields,
  readPageAgentRevision,
} from "./PageAgentOperationInput";

import type { PageAgentFields } from "./PageAgentOperationInput";

export interface ChatAgentCloneRequest {
  readonly operation: "agents.clone";
  readonly operationId: string;
  readonly agentId: string;
  readonly expectedRevision: number;
  readonly fields: PageAgentFields;
}

export interface ChatAgentDeleteRequest {
  readonly operation: "agents.delete";
  readonly operationId: string;
  readonly agentId: string;
  readonly expectedRevision: number;
}

/** Reads clone overrides through the same field contract as a targeted update. */
export function readChatAgentCloneRequest(
  input: unknown,
): ChatAgentCloneRequest {
  const parameters = readParameterRecord(input);
  requireParameterKeys(
    parameters,
    ["operationId", "agentId", "expectedRevision"],
    PAGE_AGENT_EDITABLE_FIELDS,
  );
  return {
    operation: "agents.clone",
    operationId: readIdentifier(parameters.operationId),
    agentId: readIdentifier(parameters.agentId),
    expectedRevision: readPageAgentRevision(parameters.expectedRevision),
    fields: readPageAgentFields(parameters),
  };
}

/** Reads an exact agent deletion target and its expected revision. */
export function readChatAgentDeleteRequest(
  input: unknown,
): ChatAgentDeleteRequest {
  const parameters = readParameterRecord(input);
  requireParameterKeys(
    parameters,
    ["operationId", "agentId", "expectedRevision"],
    ["confirmation"],
  );
  return {
    operation: "agents.delete",
    operationId: readIdentifier(parameters.operationId),
    agentId: readIdentifier(parameters.agentId),
    expectedRevision: readPageAgentRevision(parameters.expectedRevision),
  };
}
