/** Stable failures of reading agent profiles (PAGE-308). */
export type AgentProfileErrorCode =
  "forbidden" | "not_found" | "invalid_request" | "payload_too_large";

/** A refused read of an agent profile or a group, without any detail of the data. */
export class AgentProfileError extends Error {
  public readonly code: AgentProfileErrorCode;
  /** Which input was refused, for `invalid_request`. */
  public readonly reason: string | null;

  /**
   * Creates the refusal.
   *
   * @param code - The failure the interface reports.
   * @param reason - The refused input, for `invalid_request`.
   */
  public constructor(
    code: AgentProfileErrorCode,
    reason: string | null = null,
  ) {
    super(code);
    this.name = "AgentProfileError";
    this.code = code;
    this.reason = reason;
  }
}
