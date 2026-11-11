import type { AgentChatErrorCode } from "@/definition/Conversation";

/**
 * A refused message or read of an agent in a conversation (PAGE-311), safe to
 * hand to the agent.
 *
 * @remarks
 * `details` names what the agent needs to act on the refusal, such as the
 * limit reached; it never holds persistence details.
 */
export class AgentChatError extends Error {
  public readonly code: AgentChatErrorCode;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * Creates the refusal.
   *
   * @param code - The stable reason.
   * @param details - Facts the agent may act on.
   */
  public constructor(
    code: AgentChatErrorCode,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(code);
    this.name = "AgentChatError";
    this.code = code;
    this.details = details;
  }
}
