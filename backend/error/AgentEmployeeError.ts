/** Stable failures of agent employees (PAGE-266), safe to translate and show. */
export type AgentEmployeeErrorCode =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "conflict"
  | "usernameTaken"
  | "modelNotAllowed"
  | "accessUnsupported"
  | "accessAdminRequired"
  | "isolationUnavailable"
  | "templateNameTaken"
  | "inactive"
  | "busy"
  | "unavailable"
  /** A person stopped the answer, or its wait in the queue (PAGE-304). */
  | "stopped";

/** A refused operation on an agent employee, without persistence details. */
export class AgentEmployeeError extends Error {
  public readonly code: AgentEmployeeErrorCode;

  /** Creates a refusal with a code the interface translates. */
  public constructor(code: AgentEmployeeErrorCode) {
    super(code);
    this.code = code;
  }
}
