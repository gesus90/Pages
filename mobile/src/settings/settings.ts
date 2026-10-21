import { parseServerAddress } from "@/api/server-address";
import { SERVER_ADDRESS_OPTIONS } from "@/connection/address-policy";
import { isLanguage } from "@/i18n/language";

import type { LanguagePreference } from "@/i18n/language";
import type { ThemePreference } from "@/theme/theme-provider";

/** What the person configured in the app, kept on the device. */
export interface AppSettings {
  readonly theme: ThemePreference;
  readonly language: LanguagePreference;
  /** Address of the Pages server in its normalized form, or `null`. */
  readonly serverUrl: string | null;
}

/**
 * Validates the server address a build was configured with.
 *
 * @param address - Value of `EXPO_PUBLIC_PAGES_SERVER_URL` at build time.
 * @returns The normalized address, or `null` when the build has none or it is
 * not acceptable for this build.
 */
export function resolveBuildServerUrl(
  address: string | undefined,
): string | null {
  const result = parseServerAddress(address ?? "", SERVER_ADDRESS_OPTIONS);

  return result.ok ? result.url : null;
}

/**
 * Settings of an installation that has not been configured.
 *
 * @remarks
 * A build profile may preset the server address through
 * `EXPO_PUBLIC_PAGES_SERVER_URL`, for example a preview build for a test
 * server. The repository itself names no server.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  language: "system",
  serverUrl: resolveBuildServerUrl(process.env.EXPO_PUBLIC_PAGES_SERVER_URL),
};

/** Themes the settings accept. */
export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value);
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || isLanguage(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads stored settings, falling back to the default for each invalid field.
 *
 * @param stored - Parsed JSON from the device storage.
 * @returns Complete settings; a damaged or outdated entry never breaks the app.
 */
export function parseStoredSettings(stored: unknown): AppSettings {
  if (!isRecord(stored)) {
    return DEFAULT_SETTINGS;
  }

  return {
    theme: isThemePreference(stored.theme)
      ? stored.theme
      : DEFAULT_SETTINGS.theme,
    language: isLanguagePreference(stored.language)
      ? stored.language
      : DEFAULT_SETTINGS.language,
    serverUrl:
      typeof stored.serverUrl === "string" && stored.serverUrl !== ""
        ? stored.serverUrl
        : null,
  };
}

/**
 * Applies changes to settings.
 *
 * @param current - The settings before the change.
 * @param changes - The fields to replace; an absent field keeps its value.
 * @returns The settings after the change.
 */
export function mergeSettings(
  current: AppSettings,
  changes: Partial<AppSettings>,
): AppSettings {
  return {
    theme: changes.theme ?? current.theme,
    language: changes.language ?? current.language,
    // `null` is a value here: it removes the address.
    serverUrl:
      changes.serverUrl === undefined ? current.serverUrl : changes.serverUrl,
  };
}
