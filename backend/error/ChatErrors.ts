export type ChatErrorCode =
  | "apiModeRequired"
  | "invalidInput"
  | "accessDenied"
  | "sessionMissing"
  | "attachmentMissing"
  | "confirmationRequired"
  | "credentialsInText"
  | "emptyMessage"
  | "messageTooLong"
  | "tooManyAttachments"
  | "fileEmpty"
  | "fileTooLarge"
  | "fileNameTooLong"
  | "fileTypeNotAllowed"
  | "invalidSetting"
  | "stepLimit"
  | "contextChanged"
  | "compactionFailed"
  | "instructionsUnavailable";

/** Stable, translated chat failures; they never carry message text or provider output. */
export class ChatError extends Error {
  public readonly code: ChatErrorCode;

  public constructor(code: ChatErrorCode) {
    super(code);
    this.name = "ChatError";
    this.code = code;
  }
}
