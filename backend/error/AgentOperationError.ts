import type { AgentProjectCandidates } from "@/definition/PagesAgentOperations";

/** Fixed business failures, with visible candidates only on ambiguity. */
export class AgentOperationError extends Error {
  public readonly code:
    "NOT_FOUND" | "AMBIGUOUS" | "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE";
  public readonly status: number;
  public readonly details: AgentProjectCandidates | undefined;

  public constructor(
    code: AgentOperationError["code"],
    details?: AgentProjectCandidates,
  ) {
    super("The agent API request was rejected.");
    this.code = code;
    this.status = {
      NOT_FOUND: 404,
      AMBIGUOUS: 409,
      INVALID_REQUEST: 400,
      PAYLOAD_TOO_LARGE: 413,
    }[code];
    this.details = details;
  }
}
