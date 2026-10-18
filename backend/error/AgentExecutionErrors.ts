export type AgentExecutionErrorCode =
  | "invalidInput"
  | "accessDenied"
  | "profileSelectionRequired"
  | "roleMissing"
  | "connectionUnavailable"
  | "accessUnverified"
  | "modelUnavailable"
  | "reasoningUnsupported"
  | "requestBusy"
  | "cancelled"
  | "timeout"
  | "providerFailed"
  | "invalidOutput"
  | "credentialsInText";

/** Stable, translated failures never carry provider diagnostics or credentials. */
export class AgentExecutionError extends Error {
  public readonly code: AgentExecutionErrorCode;

  public constructor(code: AgentExecutionErrorCode) {
    super(code);
    this.name = "AgentExecutionError";
    this.code = code;
  }
}
