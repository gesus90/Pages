export type ChatErrorCode =
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
  | "stepLimit";

/** Stable, translated chat failures; they never carry message text or provider output. */
export class ChatError extends Error {
  public readonly code: ChatErrorCode;

  public constructor(code: ChatErrorCode) {
    super(code);
    this.name = "ChatError";
    this.code = code;
  }
}
