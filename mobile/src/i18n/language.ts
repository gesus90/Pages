/** Languages the app is translated into. */
export const LANGUAGES = ["de", "en"] as const;

/** A language of the app. */
export type Language = (typeof LANGUAGES)[number];

/** How the person chose the language: follow the device or force one. */
export type LanguagePreference = "system" | Language;

/**
 * Narrows unknown data to a supported language.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a supported language.
 */
export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value);
}

/**
 * Resolves the language to render in.
 *
 * @param preference - The language the person chose.
 * @param deviceLanguageCode - Primary language code of the device, if known.
 * @returns The chosen language, the device language when it is supported, or
 * English.
 */
export function resolveLanguage(
  preference: LanguagePreference,
  deviceLanguageCode: string | null | undefined,
): Language {
  if (preference !== "system") {
    return preference;
  }

  return isLanguage(deviceLanguageCode) ? deviceLanguageCode : "en";
}
