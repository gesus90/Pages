import type { AgentOperationDetails } from "@/definition/PagesAgentOperations";

/** Fixed business failures, with visible candidates only on ambiguity. */
export class AgentOperationError extends Error {
  public readonly code:
    | "NOT_FOUND"
    | "AMBIGUOUS"
    | "INVALID_REQUEST"
    | "PAYLOAD_TOO_LARGE"
    | "CONFLICT"
    | "FORBIDDEN"
    | "CONFIRMATION_REQUIRED";
  public readonly status: number;
  public readonly details: AgentOperationDetails | undefined;

  public constructor(
    code: AgentOperationError["code"],
    details?: AgentOperationDetails,
  ) {
    super(
      code === "NOT_FOUND"
        ? "Not found or no access."
        : "The agent API request was rejected.",
    );
    this.code = code;
    this.status = {
      NOT_FOUND: 404,
      CONFLICT: 409,
      FORBIDDEN: 403,
      CONFIRMATION_REQUIRED: 400,
      AMBIGUOUS: 409,
      INVALID_REQUEST: 400,
      PAYLOAD_TOO_LARGE: 413,
    }[code];
    this.details = details;
  }
}
