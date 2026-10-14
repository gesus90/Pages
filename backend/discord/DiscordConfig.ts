import type { DiscordInstanceStatus } from "@/definition/Discord";

/** The Discord application of this Pages instance; every value is a server-side secret. */
export interface DiscordApplication {
  /** Also the user id of the bot, which the permission check relies on. */
  readonly applicationId: string;
  readonly clientSecret: string;
  readonly botToken: string;
}

/** Names of the environment variables that configure the Discord application. */
export const DISCORD_SETTING_NAMES = {
  applicationId: "PAGES_DISCORD_APPLICATION_ID",
  botToken: "PAGES_DISCORD_BOT_TOKEN",
  clientSecret: "PAGES_DISCORD_CLIENT_SECRET",
} as const;

/** Optional address under which Discord and other devices reach this instance. */
export const PUBLIC_URL_SETTING_NAME = "PAGES_PUBLIC_URL";

const SNOWFLAKE_PATTERN = /^\d{5,25}$/;

/** A secret never contains whitespace; a trimmed non-empty value is enough to try it. */
function readSecret(value: string | undefined): string | null {
  const secret = value?.trim() ?? "";

  return secret === "" || /\s/.test(secret) ? null : secret;
}

/**
 * Reads the Discord application from the environment.
 *
 * @param environment - Environment variables of the server process.
 * @returns The application, or `null` while a setting is missing or malformed.
 */
export function readDiscordApplication(
  environment: NodeJS.ProcessEnv = process.env,
): DiscordApplication | null {
  const applicationId =
    environment[DISCORD_SETTING_NAMES.applicationId]?.trim();
  const clientSecret = readSecret(
    environment[DISCORD_SETTING_NAMES.clientSecret],
  );
  const botToken = readSecret(environment[DISCORD_SETTING_NAMES.botToken]);

  if (
    applicationId === undefined ||
    !SNOWFLAKE_PATTERN.test(applicationId) ||
    clientSecret === null ||
    botToken === null
  ) {
    return null;
  }

  return { applicationId, botToken, clientSecret };
}

/**
 * Describes which settings of the Discord application are still missing.
 *
 * @param environment - Environment variables of the server process.
 * @returns Whether the feature can run, and the names, never the values, of
 * the settings that are missing or malformed.
 */
export function describeDiscordInstance(
  environment: NodeJS.ProcessEnv = process.env,
): DiscordInstanceStatus {
  const missingSettings: string[] = [];
  const applicationId =
    environment[DISCORD_SETTING_NAMES.applicationId]?.trim();

  if (applicationId === undefined || !SNOWFLAKE_PATTERN.test(applicationId)) {
    missingSettings.push(DISCORD_SETTING_NAMES.applicationId);
  }

  if (readSecret(environment[DISCORD_SETTING_NAMES.clientSecret]) === null) {
    missingSettings.push(DISCORD_SETTING_NAMES.clientSecret);
  }

  if (readSecret(environment[DISCORD_SETTING_NAMES.botToken]) === null) {
    missingSettings.push(DISCORD_SETTING_NAMES.botToken);
  }

  return { isConfigured: missingSettings.length === 0, missingSettings };
}

/**
 * Resolves the public address of this instance for links and the OAuth redirect.
 *
 * @param requestOrigin - Origin of the request that starts the connection.
 * @param environment - Environment variables of the server process.
 * @returns The configured `PAGES_PUBLIC_URL` as origin when it is a valid
 * http(s) address, otherwise the request origin; never a trailing slash.
 *
 * @remarks
 * Behind a reverse proxy the request origin is the internal one, and a phone
 * that scans the QR code cannot reach it; the setting names the public address.
 */
export function resolvePublicBaseUrl(
  requestOrigin: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment[PUBLIC_URL_SETTING_NAME]?.trim();

  if (configured) {
    try {
      const url = new URL(configured);

      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      console.warn(
        `Pages ignores ${PUBLIC_URL_SETTING_NAME}: it is not a valid address.`,
      );
    }
  }

  return new URL(requestOrigin).origin;
}
