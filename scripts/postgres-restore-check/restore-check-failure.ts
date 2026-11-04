/** The part of the check that failed; it names the failure in the log event. */
export type RestoreCheckStep =
  | "mount"
  | "leftover"
  | "base_backup"
  | "verify"
  | "source"
  | "archive"
  | "restore"
  | "recovery"
  | "comparison"
  | "cleanup";

/** The check failed; the message holds names and numbers only, never a row. */
export class RestoreCheckFailure extends Error {
  public readonly step: RestoreCheckStep;
  /** SQLSTATE of the refused statement, when one caused the failure. */
  public readonly code: string | null;

  public constructor(
    step: RestoreCheckStep,
    message: string,
    code: string | null = null,
  ) {
    super(message);
    this.name = "RestoreCheckFailure";
    this.step = step;
    this.code = code;
  }
}
