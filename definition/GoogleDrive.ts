/**
 * Where the Google Drive connection of the instance stands, as the last real
 * Drive request showed it.
 *
 * - `not_configured`: the OAuth client of the instance is missing.
 * - `disconnected`: no Google account was ever connected.
 * - `connected`: a read-only Drive request just succeeded.
 * - `reauthorization_required`: Google refused the stored access; only a new
 *   sign-in helps.
 * - `unavailable`: Drive could not confirm the connection for a reason a new
 *   sign-in does not fix, for example a disabled Drive API.
 */
export type GoogleDriveConnectionState =
  | "not_configured"
  | "disconnected"
  | "connected"
  | "reauthorization_required"
  | "unavailable";

/** Why Drive did not confirm the connection; never contains Google's raw answer. */
export type GoogleDriveProblem =
  | "access_revoked"
  | "scope_missing"
  | "client_invalid"
  | "drive_api_disabled"
  | "google_unreachable"
  | "account_changed"
  | "secret_unavailable";

/** The Google Drive connection as the system settings show it to an administrator. */
export interface GoogleDriveStatus {
  readonly state: GoogleDriveConnectionState;
  readonly problem: GoogleDriveProblem | null;
  /** The address of the connected Google account, when Drive names it. */
  readonly accountEmail: string | null;
  /** Names, never values, of the server settings that are missing. */
  readonly missingSettings: readonly string[];
  /** The redirect URIs Google has to allow at the OAuth client: one per allowed origin. */
  readonly redirectUris: readonly string[];
  /** Whether this request came in on an allowed origin, so a sign-in may start here. */
  readonly canSignIn: boolean;
  /** Whether the working connection lacks the read access that Storage needs for the folder tree. */
  readonly needsFolderAccess: boolean;
  /** Whether the working connection lacks the write access Storage needs to change files (PAGE-270). */
  readonly needsWriteAccess: boolean;
  /** Whether Drive is the in-memory simulation of a development server, not a real account. */
  readonly isSimulation: boolean;
}

/** What happened when Google sent the browser back to Pages. */
export type GoogleDriveCallbackOutcome =
  | "connected"
  | "denied"
  | "invalid"
  | "expired"
  | "scope_missing"
  | "write_declined"
  | "account_mismatch"
  | "failed"
  | "forbidden"
  | "not_configured";

/** Every callback outcome, for reading it back from the settings address. */
export const GOOGLE_DRIVE_CALLBACK_OUTCOMES: readonly GoogleDriveCallbackOutcome[] =
  [
    "connected",
    "denied",
    "invalid",
    "expired",
    "scope_missing",
    "write_declined",
    "account_mismatch",
    "failed",
    "forbidden",
    "not_configured",
  ];

/** The answer of the Google Drive endpoint of the system settings. */
export type GoogleDriveActionResult =
  | { readonly ok: true; readonly authorizeUrl: string }
  | {
      readonly ok: false;
      readonly error:
        "forbidden" | "not_configured" | "origin_not_allowed" | "failed";
    };
