/** Stable management failures safe to translate and display to the requesting user. */
export type AdministrationErrorCode =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "inUse"
  | "agentInUse"
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

/** Blocks deleting a group or department that agents still use as scope or usage share, or that a connection lists in its usage scope. */
export class AgentScopeInUseError extends AdministrationError {
  public readonly agents: readonly string[];

  /** Creates the lock with the names of the agents and connections that must be changed first. */
  public constructor(agents: readonly string[]) {
    super("agentInUse");
    this.agents = agents;
  }
}
