import type { AgentChatTaskErrorCode } from "@/definition/AgentChatTask";

/** Why a scheduled task of a chat agent was refused (PAGE-392); the code goes to the agent or the page. */
export class AgentChatTaskError extends Error {
  public readonly code: AgentChatTaskErrorCode;

  /**
   * Creates the refusal.
   *
   * @param code - The reason the agent and the chat page translate.
   */
  public constructor(code: AgentChatTaskErrorCode) {
    super(code);
    this.name = "AgentChatTaskError";
    this.code = code;
  }
}
