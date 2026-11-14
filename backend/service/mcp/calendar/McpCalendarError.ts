import { DatabaseExecutorError } from "@/backend/database/executor/DatabaseExecutorErrors";
import { CalendarError } from "@/backend/error/CalendarError";
import { McpDeviceError } from "@/backend/error/McpDeviceError";

/** Error codes of the calendar API, as the MCP HTTP conventions name them (PAGE-301). */
export type McpCalendarErrorCode =
  | "invalid_request"
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "rate_limited"
  | "server_unavailable";

/** Seconds after which a limited or unavailable request may be repeated. */
export const MCP_CALENDAR_RETRY_AFTER_SECONDS = 5;

const STATUS_OF_CODE: Readonly<Record<McpCalendarErrorCode, number>> = {
  invalid_request: 400,
  invalid_token: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
  server_unavailable: 503,
};

/** What a failure may carry beside its code. */
export interface McpCalendarErrorDetails {
  /** The stored revision of an event, for a `conflict` of a stale `expectedRevision`. */
  readonly currentRevision?: number;
  /** Seconds to wait, for `rate_limited` and `server_unavailable`. */
  readonly retryAfterSeconds?: number;
}

/**
 * Fixed public failure of the calendar API.
 *
 * @remarks
 * It carries a code, for a stale revision the stored revision, and nothing
 * else: no message of a service, no part of the request and never data of
 * an event the account may not see.
 */
export class McpCalendarError extends Error {
  public readonly code: McpCalendarErrorCode;
  public readonly status: number;
  public readonly currentRevision: number | null;
  public readonly retryAfterSeconds: number | null;

  /**
   * Creates the error.
   *
   * @param code - The error code of the interface; it decides the HTTP status.
   * @param details - The stored revision of a conflict or the wait of a limit.
   */
  public constructor(
    code: McpCalendarErrorCode,
    details: McpCalendarErrorDetails = {},
  ) {
    super("The calendar request was rejected.");
    this.name = "McpCalendarError";
    this.code = code;
    this.status = STATUS_OF_CODE[code];
    this.currentRevision = details.currentRevision ?? null;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
  }

  /** The body of the answer: `{ error }`, with `currentRevision` for a stale revision. */
  public toBody(): Readonly<Record<string, unknown>> {
    return this.currentRevision === null
      ? { error: this.code }
      : { error: this.code, currentRevision: this.currentRevision };
  }

  /** The headers of the answer: `Retry-After` for a limit or an unavailable server. */
  public headers(): Readonly<Record<string, string>> {
    if (this.code !== "rate_limited" && this.code !== "server_unavailable")
      return {};
    return {
      "Retry-After": String(
        this.retryAfterSeconds ?? MCP_CALENDAR_RETRY_AFTER_SECONDS,
      ),
    };
  }
}

/** Translates the token check of the device API; other device failures keep its mapping. */
function fromDeviceError(error: McpDeviceError): McpCalendarError | null {
  if (error.code === "invalid_token")
    return new McpCalendarError("invalid_token");
  if (error.code === "slow_down")
    return new McpCalendarError("rate_limited", {
      retryAfterSeconds: error.retryAfterSeconds ?? undefined,
    });
  return null;
}

/**
 * Translates a failure of the calendar service, the token check or the
 * database into the error of the interface.
 *
 * @param error - Whatever a service, a parser or the token check threw.
 * @returns The interface error, or `null` for a failure that is not the
 * client's doing and stays an internal error.
 *
 * @remarks
 * The calendar service already answers an invisible event with `not_found`
 * like a missing one; its message is dropped here all the same.
 */
export function toMcpCalendarError(error: unknown): McpCalendarError | null {
  if (error instanceof McpCalendarError) return error;
  if (error instanceof CalendarError)
    return new McpCalendarError(error.code, {
      currentRevision:
        error.code === "conflict" ? error.currentRevision : undefined,
    });
  if (error instanceof McpDeviceError) return fromDeviceError(error);
  if (error instanceof DatabaseExecutorError)
    return new McpCalendarError("server_unavailable", {
      retryAfterSeconds: error.retryAfterSeconds,
    });
  return null;
}
