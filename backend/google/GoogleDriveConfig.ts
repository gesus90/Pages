/** The OAuth client of this Pages instance at Google; the secret never leaves the server. */
export interface GoogleOAuthApplication {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Names of the environment variables that configure the Google OAuth client. */
export const GOOGLE_DRIVE_SETTING_NAMES = {
  clientId: "PAGES_GOOGLE_DRIVE_CLIENT_ID",
  clientSecret: "PAGES_GOOGLE_DRIVE_CLIENT_SECRET",
} as const;

/**
 * The scope every connection needs.
 *
 * @remarks
 * `drive.file` is the narrowest Drive scope Google lists as non-sensitive. It
 * reads no file the person did not open with or create through Pages, yet it
 * allows `about.get`, the read-only request that proves the connection.
 */
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * The read scope the Storage area needs to browse the existing folder tree (PAGE-188).
 *
 * @remarks
 * `drive.file` alone shows only files Pages created or opened, so a folder
 * tree that existed before stays invisible. `drive.readonly` reads every
 * folder and file the Google account itself may open and changes nothing.
 * Google counts it as a restricted scope: an unverified OAuth client of an
 * instance shows Google's warning and its user limit during the consent. With
 * Google's granular consent the person may decline it; the connection then
 * keeps working with `drive.file`, and Storage says that it shows only the
 * files of Pages.
 */
export const GOOGLE_DRIVE_READ_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";

/** The scopes the sign-in asks for, see {@link GOOGLE_DRIVE_SCOPE} and {@link GOOGLE_DRIVE_READ_SCOPE}. */
export const GOOGLE_DRIVE_REQUESTED_SCOPES: readonly string[] = [
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DRIVE_READ_SCOPE,
];

/** Granted scopes that let Storage read the whole folder tree of the account. */
export const GOOGLE_DRIVE_TREE_SCOPES: readonly string[] = [
  GOOGLE_DRIVE_READ_SCOPE,
  "https://www.googleapis.com/auth/drive",
];

const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/;

function readSetting(value: string | undefined): string | null {
  const setting = value?.trim() ?? "";

  return setting === "" || /\s/.test(setting) ? null : setting;
}

function readClientId(environment: NodeJS.ProcessEnv): string | null {
  const clientId = readSetting(
    environment[GOOGLE_DRIVE_SETTING_NAMES.clientId],
  );

  return clientId !== null && CLIENT_ID_PATTERN.test(clientId)
    ? clientId
    : null;
}

/**
 * Reads the Google OAuth client from the environment.
 *
 * @param environment - Environment variables of the server process.
 * @returns The client, or `null` while a setting is missing or malformed.
 */
export function readGoogleOAuthApplication(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleOAuthApplication | null {
  const clientId = readClientId(environment);
  const clientSecret = readSetting(
    environment[GOOGLE_DRIVE_SETTING_NAMES.clientSecret],
  );

  return clientId !== null && clientSecret !== null
    ? { clientId, clientSecret }
    : null;
}

/**
 * Names the settings of the Google OAuth client that are missing or malformed.
 *
 * @param environment - Environment variables of the server process.
 * @returns The names, never the values.
 */
export function findMissingGoogleDriveSettings(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const missingSettings: string[] = [];

  if (readClientId(environment) === null) {
    missingSettings.push(GOOGLE_DRIVE_SETTING_NAMES.clientId);
  }

  if (
    readSetting(environment[GOOGLE_DRIVE_SETTING_NAMES.clientSecret]) === null
  ) {
    missingSettings.push(GOOGLE_DRIVE_SETTING_NAMES.clientSecret);
  }

  return missingSettings;
}
