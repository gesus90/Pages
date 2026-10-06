/** Stable management failures safe to translate and display to the requesting user. */
export type AdministrationErrorCode =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "inUse"
  | "lastAdministrator"
  | "lastMembership";

/** Indicates a rejected management operation, without exposing persistence details. */
export class AdministrationError extends Error {
  public readonly code: AdministrationErrorCode;

  /** Creates a rejection with a user-facing translation key. */
  public constructor(code: AdministrationErrorCode) {
    super(code);
    this.code = code;
  }
}
