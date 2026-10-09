export type TextAssistantErrorCode =
  | "invalidInput"
  | "accessDenied"
  | "contextMissing"
  | "roleMissing"
  | "connectionUnavailable"
  | "accessUnverified"
  | "modelUnavailable"
  | "reasoningUnsupported"
  | "emptySelection"
  | "versionConflict"
  | "conversationMissing"
  | "requestBusy"
  | "cancelled"
  | "timeout"
  | "providerFailed"
  | "invalidOutput"
  | "credentialsInText";

/** Stable, translated failures never carry provider diagnostics or credentials. */
export class TextAssistantError extends Error {
  public readonly code: TextAssistantErrorCode;

  public constructor(code: TextAssistantErrorCode) {
    super(code);
    this.name = "TextAssistantError";
    this.code = code;
  }
}
