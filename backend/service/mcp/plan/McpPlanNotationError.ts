import type { PlanNotationIssue } from "./PlanNotationIssue";

/** Error codes of the plan notation API, as the interface names them. */
export type McpPlanNotationErrorCode =
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "plan_running"
  | "too_large"
  | "notation_invalid"
  | "invalid_request";

const STATUS_OF_CODE: Readonly<Record<McpPlanNotationErrorCode, number>> = {
  invalid_token: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  plan_running: 409,
  too_large: 413,
  notation_invalid: 422,
  invalid_request: 400,
};

/** What a failure adds to its code: the findings of a notation or the current revision of a plan. */
export interface McpPlanNotationFailureDetail {
  readonly issues?: readonly PlanNotationIssue[];
  readonly currentRevision?: number;
}

/**
 * Fixed public failure of the plan notation API (PAGE-250).
 *
 * @remarks
 * It carries a code and a status, the findings of `notation_invalid` and
 * the current revision of `conflict`; no message of a service and no part
 * of the request leaves the server through it.
 */
export class McpPlanNotationError extends Error {
  public readonly code: McpPlanNotationErrorCode;
  public readonly status: number;
  public readonly detail: McpPlanNotationFailureDetail;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   * @param detail - The findings or the current revision, where the code has them.
   */
  public constructor(
    code: McpPlanNotationErrorCode,
    detail: McpPlanNotationFailureDetail = {},
  ) {
    super("The plan notation request was rejected.");
    this.name = "McpPlanNotationError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
    this.detail = detail;
  }

  /** The body of the answer: `{ error, issues?, currentRevision? }`. */
  public body(): Readonly<Record<string, unknown>> {
    return {
      error: this.code,
      ...(this.detail.issues === undefined
        ? {}
        : { issues: this.detail.issues }),
      ...(this.detail.currentRevision === undefined
        ? {}
        : { currentRevision: this.detail.currentRevision }),
    };
  }
}
