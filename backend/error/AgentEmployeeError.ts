/** Stable failures of agent employees, safe to translate and show. */
export type AgentEmployeeErrorCode =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "conflict"
  | "usernameTaken"
  | "modelNotAllowed"
  | "accessUnsupported"
  | "accessAdminRequired"
  | "accessModeRequired"
  | "templateNameTaken"
  | "inactive"
  | "busy"
  | "unavailable"
  /** A person stopped the answer, or its wait in the queue. */
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
