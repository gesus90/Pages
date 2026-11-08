export type ChatErrorCode =
  | "disabled"
  | "nativeContextManaged"
  | "invalidInput"
  | "accessDenied"
  /** The request's origin is not the address Pages believes it has; a proxy or setup problem, no missing right. */
  | "originRejected"
  | "sessionMissing"
  | "attachmentMissing"
  | "confirmationRequired"
  | "credentialsInText"
  | "emptyMessage"
  | "messageAlreadySent"
  | "messageTooLong"
  | "tooManyAttachments"
  /** More than four attachment transfers of one account at once over Pica Mobile. */
  | "tooManyTransfers"
  | "fileEmpty"
  | "fileTooLarge"
  | "fileNameTooLong"
  | "fileTypeNotAllowed"
  | "invalidSetting"
  | "stepLimit"
  | "contextChanged"
  | "compactionFailed"
  | "instructionsUnavailable"
  | "acpProviderUnsupported"
  | "acpPermissionModeUnsupported";

/** Stable, translated chat failures; they never carry message text or provider output. */
export class ChatError extends Error {
  public readonly code: ChatErrorCode;

  public constructor(code: ChatErrorCode) {
    super(code);
    this.name = "ChatError";
    this.code = code;
  }
}
