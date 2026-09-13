/**
 * An active login session of a user, as shown in the settings screen.
 *
 * @remarks
 * Device information is derived from the user agent recorded at login time
 * and may be unknown for sessions created before that metadata existed.
 * Only the owner themselves ever receives their own summaries.
 */
export interface SessionSummary {
  readonly id: string;
  readonly browser: string | null;
  readonly operatingSystem: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly isCurrent: boolean;
}
