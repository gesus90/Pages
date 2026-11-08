import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { OperationReusedError } from "@/backend/service/InterfaceOperationJournal";

import type { WikiErrorCode } from "@/backend/error/WikiErrors";

/** Error codes of the wiki API, as the interface names them. */
export type McpWikiErrorCode =
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "invalid_request"
  | "text_not_found"
  | "text_not_unique";

const STATUS_OF_CODE: Readonly<Record<McpWikiErrorCode, number>> = {
  conflict: 409,
  forbidden: 403,
  invalid_request: 400,
  invalid_token: 401,
  not_found: 404,
  text_not_found: 400,
  text_not_unique: 400,
  too_large: 413,
};

/** Service codes that name something which does not exist or is hidden from the account. */
const NOT_FOUND_CODES: ReadonlySet<WikiErrorCode> = new Set(["versionMissing"]);

/**
 * Fixed public failure of the wiki API; it carries a code and never a diagnosis.
 *
 * @remarks
 * A conflict also carries the revision the page has now, the only detail the
 * interface names.
 */
export class McpWikiError extends Error {
  public readonly code: McpWikiErrorCode;
  public readonly status: number;
  /** The current revision of the page, set for `conflict` only. */
  public readonly revision: number | null;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   * @param revision - The current revision of the page for `conflict`.
   */
  public constructor(code: McpWikiErrorCode, revision: number | null = null) {
    super("The wiki request was rejected.");
    this.name = "McpWikiError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
    this.revision = revision;
  }

  /** The answer body: the code, and the current revision of a conflict. */
  public toBody(): Readonly<Record<string, string | number>> {
    return this.revision === null
      ? { error: this.code }
      : { error: this.code, revision: this.revision };
  }
}

/** Maps the code of a rejected wiki input to the code of the interface. */
function codeOfValidation(code: WikiErrorCode): McpWikiErrorCode {
  if (NOT_FOUND_CODES.has(code)) return "not_found";
  if (code === "fileTooLarge") return "too_large";
  return "invalid_request";
}

/**
 * Translates a failure of the wiki service into the error of the interface.
 *
 * @param error - Whatever a service threw.
 * @returns The interface error, or `null` for a failure that is not the
 * client's doing and stays an internal error.
 *
 * @remarks
 * A missing right is `forbidden`; a page the account cannot see is
 * `not_found`, exactly like one that does not exist. A save that lost against
 * a newer one is `conflict` with the revision the page has now.
 */
export function toMcpWikiError(error: unknown): McpWikiError | null {
  if (error instanceof McpWikiError) return error;
  if (error instanceof WikiAccessDeniedError)
    return new McpWikiError("forbidden");
  if (error instanceof WikiPageNotFoundError)
    return new McpWikiError("not_found");
  if (error instanceof WikiConflictError)
    return new McpWikiError("conflict", error.current.revision);
  if (error instanceof WikiValidationError)
    return new McpWikiError(codeOfValidation(error.code));
  if (error instanceof OperationReusedError)
    return new McpWikiError("invalid_request");
  return null;
}
