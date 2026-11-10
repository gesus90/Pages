/** Stable failures of agent employees (PAGE-266), safe to translate and show. */
export type AgentEmployeeErrorCode =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "conflict"
  | "usernameTaken"
  | "modelNotAllowed"
  | "accessUnsupported"
  | "templateNameTaken"
  | "inactive"
  | "busy"
  | "unavailable";

/** A refused operation on an agent employee, without persistence details. */
export class AgentEmployeeError extends Error {
  public readonly code: AgentEmployeeErrorCode;

  /** Creates a refusal with a code the interface translates. */
  public constructor(code: AgentEmployeeErrorCode) {
    super(code);
    this.code = code;
  }
}
