import { methods } from "@agentclientprotocol/sdk";

import { CLI_LINE_LIMIT_BYTES } from "@/backend/agents/cli/CliSessionProcess";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";

import type { ContentBlock } from "@agentclientprotocol/sdk";

/** Room for envelope fields the SDK may add beyond `jsonrpc`, `id`, `method` and `params`. */
const ENVELOPE_RESERVE_BYTES = 1024;

/**
 * The UTF-8 bytes one outgoing ACP message may take: the 8 MiB line limit of
 * the session input minus the envelope reserve.
 */
export const ACP_MESSAGE_BUDGET_BYTES =
  CLI_LINE_LIMIT_BYTES - ENVELOPE_RESERVE_BYTES;

/** One request Pages sends to an adapter, before the SDK numbers it. */
export interface AcpOutgoingMessage {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Safe identities that name an oversized message in the log. */
export interface AcpMessageOwner {
  readonly sessionId: string | null;
  readonly provider: string;
}

/**
 * Measures the complete JSON-RPC line exactly as the line channel writes it.
 *
 * @remarks
 * The UTF-8 bytes include the envelope, every escape character and the Base64
 * of inline images; the request ID is counted with its longest possible form.
 */
export function acpMessageBytes(message: AcpOutgoingMessage): number {
  return Buffer.byteLength(
    JSON.stringify({
      jsonrpc: "2.0",
      id: Number.MAX_SAFE_INTEGER,
      method: message.method,
      params: message.params,
    }),
  );
}

/**
 * The bytes one block adds to the prompt array of a message.
 *
 * @remarks
 * The separating comma is counted for every block, so a sum never falls short
 * of the real line.
 */
export function acpBlockBytes(block: ContentBlock): number {
  return Buffer.byteLength(JSON.stringify(block)) + 1;
}

/**
 * The bytes blocks placed in front of the prompt of this message may still take.
 *
 * @param message - The message with the blocks that always follow, such as chat attachments.
 * @returns The remaining budget; negative when the message alone is already too large.
 */
export function acpPromptRoom(message: AcpOutgoingMessage): number {
  return ACP_MESSAGE_BUDGET_BYTES - acpMessageBytes(message);
}

/**
 * Whether the complete message fits into one line of the session input.
 *
 * @remarks
 * A message that does not fit is logged with its byte count and safe
 * identities only, never with any prompt or file content.
 */
export function isAcpMessageWithinBudget(
  message: AcpOutgoingMessage,
  owner: AcpMessageOwner,
): boolean {
  const bytes = acpMessageBytes(message);
  if (bytes <= ACP_MESSAGE_BUDGET_BYTES) return true;
  logEvent({
    level: "warn",
    event: "acp.message.input_too_large",
    component: "AcpPromptBudget",
    message: "ACP input message exceeded its limit and was not sent",
    metadata: {
      code: "acp_input_too_large",
      method: message.method,
      sessionId: owner.sessionId,
      provider: owner.provider,
      bytes,
      count: ACP_MESSAGE_BUDGET_BYTES,
    },
  });
  return false;
}

/**
 * Refuses a message before it is written when it exceeds the input limit.
 *
 * @throws {AgentError} `acp_input_too_large`, which names the input direction
 * and is never confused with an oversized output of the agent.
 */
export function requireAcpMessageBudget(
  message: AcpOutgoingMessage,
  owner: AcpMessageOwner,
): void {
  if (!isAcpMessageWithinBudget(message, owner))
    throw new AgentError("acp_input_too_large");
}

/**
 * The parameters of a `session/prompt` request, measured as the complete message.
 *
 * @param sessionId - The protocol session.
 * @param prompt - Every block of the prompt.
 * @param provider - The runner, named in the log of a refused message.
 * @throws {AgentError} `acp_input_too_large` before anything is written.
 */
export function acpPromptParams(
  sessionId: string,
  prompt: ContentBlock[],
  provider: string,
): { readonly sessionId: string; readonly prompt: ContentBlock[] } {
  const params = { sessionId, prompt };
  requireAcpMessageBudget(
    { method: methods.agent.session.prompt, params },
    { sessionId, provider },
  );
  return params;
}
