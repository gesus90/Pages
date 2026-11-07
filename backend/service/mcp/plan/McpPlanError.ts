import { DatabaseExecutorError } from "@/backend/database/executor/DatabaseExecutorErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

/** Error codes of the plan API, as the interface names them. */
export type McpPlanErrorCode =
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "invalid_request"
  | "unavailable";

const STATUS_OF_CODE: Readonly<Record<McpPlanErrorCode, number>> = {
  conflict: 409,
  forbidden: 403,
  invalid_request: 400,
  invalid_token: 401,
  not_found: 404,
  too_large: 413,
  unavailable: 503,
};

/** The codes of the plan operation layer and the code of the interface each becomes. */
const OPERATION_CODES: Readonly<
  Record<AgentOperationError["code"], McpPlanErrorCode>
> = {
  AMBIGUOUS: "conflict",
  CONFIRMATION_REQUIRED: "invalid_request",
  CONFLICT: "conflict",
  FORBIDDEN: "forbidden",
  INVALID_REQUEST: "invalid_request",
  NOT_FOUND: "not_found",
  PAYLOAD_TOO_LARGE: "too_large",
};

/**
 * Fixed public failure of the plan API.
 *
 * @remarks
 * It carries a code, a status and at most the stable `reason` of the plan
 * operation layer; neither a message nor any part of the request leaves the
 * server through it.
 */
export class McpPlanError extends Error {
  public readonly code: McpPlanErrorCode;
  public readonly status: number;
  public readonly detail: string | null;
  /** Seconds after which a repeated request may succeed; set with `503`. */
  public readonly retryAfterSeconds: number | null;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   * @param options - The stable reason of the refusal and the wait before a retry, where they exist.
   */
  public constructor(
    code: McpPlanErrorCode,
    options: {
      readonly detail?: string | null;
      readonly retryAfterSeconds?: number | null;
    } = {},
  ) {
    super("The plan request was rejected.");
    this.name = "McpPlanError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
    this.detail = options.detail ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function fromOperationError(error: AgentOperationError): McpPlanError {
  const details = error.details;
  const reason =
    details !== undefined &&
    "reason" in details &&
    typeof details.reason === "string"
      ? details.reason
      : null;
  return new McpPlanError(OPERATION_CODES[error.code], { detail: reason });
}

/**
 * Translates a failure of the plan operation layer into the error of the interface.
 *
 * @param error - Whatever the API or the operation layer threw.
 * @returns The interface error, or `null` for a failure that is not the
 * client's doing and stays an internal error.
 *
 * @remarks
 * `INVALID_REQUEST` becomes `400 invalid_request`, `FORBIDDEN` `403
 * forbidden`, `NOT_FOUND` `404 not_found`, `CONFLICT` `409 conflict`,
 * `PAYLOAD_TOO_LARGE` `413 too_large` and an unavailable database `503
 * unavailable`; the `reason` of the operation layer becomes the `detail`. A
 * token the identity check refuses stays `401 invalid_token`.
 */
export function toMcpPlanError(error: unknown): McpPlanError | null {
  if (error instanceof McpPlanError) return error;
  if (error instanceof AgentOperationError) return fromOperationError(error);
  if (error instanceof McpAuthorizationError && error.status === 401)
    return new McpPlanError("invalid_token");
  if (error instanceof DatabaseExecutorError)
    return new McpPlanError("unavailable", {
      retryAfterSeconds: error.retryAfterSeconds,
    });
  return null;
}
