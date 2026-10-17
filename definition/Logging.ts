/** Instance-wide calendar retention, independent of personal display settings. */
export const DEFAULT_LOG_RETENTION_DAYS = 30;

/** Narrows an untrusted setting to the supported inclusive range. */
export function isLogRetentionDays(candidate: unknown): candidate is number {
  return (
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate >= 0 &&
    candidate <= 365
  );
}

/** Safe operational state shown only to system administrators. */
export interface LoggingStatus {
  readonly state: "healthy" | "degraded" | "starting";
  readonly queuedEntries: number;
  readonly lostEntries: number;
  readonly failureCode: string | null;
}
