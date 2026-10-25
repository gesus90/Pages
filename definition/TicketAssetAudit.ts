/** An attachment inventory is diagnostic and never changes tickets or replaces images. */
export interface TicketAssetFinding {
  readonly ticketId: string;
  readonly ticketKey: string;
  readonly reference: string;
  readonly reason:
    | "temporaryUpload"
    | "missingUpload"
    | "missingUploadFile"
    | "expiredUpload"
    | "outsideTicketStorage"
    | "externalImage"
    | "missingAttachment"
    | "missingFile"
    | "legacyStorage"
    | "checksumMismatch";
}

/** Read-only administrator report, generated on demand. */
export interface TicketAssetAudit {
  readonly checkedAt: string;
  readonly ticketCount: number;
  readonly attachmentCount: number;
  readonly findings: readonly TicketAssetFinding[];
}
