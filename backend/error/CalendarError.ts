/** Reasons the calendar refuses a request (PAGE-301). */
export type CalendarErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "too_large";

/**
 * A refused calendar request.
 *
 * @remarks
 * The message never names data of an event the account may not see; an
 * invisible event is `not_found` like a missing one. `currentRevision` is set
 * for a `conflict` of a stale `expectedRevision`.
 */
export class CalendarError extends Error {
  public readonly code: CalendarErrorCode;
  public readonly currentRevision: number | undefined;

  /**
   * Creates the error.
   *
   * @param code - The reason.
   * @param message - A short text without foreign data.
   * @param currentRevision - The stored revision of a conflict.
   */
  public constructor(
    code: CalendarErrorCode,
    message: string,
    currentRevision?: number,
  ) {
    super(message);
    this.name = "CalendarError";
    this.code = code;
    this.currentRevision = currentRevision;
  }
}
