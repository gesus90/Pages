import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";
import type { AgentRejectionReason } from "@/definition/PagesAgentOperations";

type Reason = AgentRejectionReason["reason"];

/**
 * Refusals of a definition that name the input to change.
 *
 * @remarks
 * `agent_usage_denied` is a model refusal here: the operation service reads
 * the agent as the person sees it before a save, so an agent that does not
 * belong to the person never reaches the save. What remains is a model that is
 * missing, no longer released for the person, or no longer matches its
 * connection.
 */
const AGENT_REASONS: Readonly<Partial<Record<AgentErrorCode, Reason>>> = {
  profile_limit_reached: "agent_limit_reached",
  agent_usage_denied: "model_unavailable",
  configuration_invalid: "configuration_invalid",
  parameter_invalid: "configuration_invalid",
  parameter_required: "configuration_invalid",
  parameter_number_invalid: "configuration_invalid",
  profile_target_invalid: "sharing_target_unavailable",
  parameter_reference_unavailable: "parameter_reference_unavailable",
  parameter_ticket_unavailable: "parameter_reference_unavailable",
  reasoning_effort_unsupported: "reasoning_unsupported",
};

/**
 * What keeps a saved model from running for the person.
 *
 * @remarks
 * `accessDenied` belongs here: the identity of the call was verified before,
 * so it is the scope of the model's connection that no longer admits the
 * person. FORBIDDEN stays what the documentation says: not the owner.
 */
const MODEL_CODES: ReadonlySet<AgentExecutionErrorCode> = new Set([
  "accessDenied",
  "connectionUnavailable",
  "accessUnverified",
  "modelUnavailable",
]);

function rejected(reason: Reason): AgentOperationError {
  return new AgentOperationError("INVALID_REQUEST", { reason });
}

function translateAgentError(error: AgentError): AgentOperationError {
  if (error.code === "profile_not_found")
    return new AgentOperationError("NOT_FOUND");
  if (error.code === "profile_running")
    return new AgentOperationError("CONFLICT", { reason: "agent_running" });
  if (error.code === "profile_conflict")
    return new AgentOperationError("CONFLICT");
  // A workspace the agent refers to is a reference that cannot be used, whatever the registry says.
  if (error.code.startsWith("workspace_"))
    return rejected("parameter_reference_unavailable");
  const reason = AGENT_REASONS[error.code];
  return reason === undefined
    ? new AgentOperationError("INVALID_REQUEST")
    : rejected(reason);
}

function translateExecutionError(
  error: AgentExecutionError,
): AgentOperationError {
  if (MODEL_CODES.has(error.code)) return rejected("model_unavailable");
  if (error.code === "reasoningUnsupported")
    return rejected("reasoning_unsupported");
  if (error.code === "credentialsInText")
    return rejected("credentials_in_text");
  return new AgentOperationError("INVALID_REQUEST");
}

/**
 * Turns the failures of the agent management into the fixed codes of the agent API.
 *
 * @param error - Whatever the agent service or the model rules threw.
 * @returns The agent API error for a business failure, or the error unchanged.
 *
 * @remarks
 * No message of the management is passed on, only its class: a refusal never
 * names a connection, a provider or the state of a model grant. A revision
 * conflict is translated without its revision; the caller reads the current one.
 */
export function translatePageAgentError(error: unknown): unknown {
  if (error instanceof AgentError) return translateAgentError(error);
  if (error instanceof AgentExecutionError)
    return translateExecutionError(error);
  return error;
}
