/** Languages currently available in Pages. */
export const LANGUAGE = {
  GERMAN: "de",
  ENGLISH: "en",
} as const;

/** A language supported by the application. */
export type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE];

/**
 * Narrows unknown data to a supported language.
 *
 * @param value - Value received from an untrusted source.
 * @returns Whether the value is a supported language.
 */
export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (Object.values(LANGUAGE) as readonly string[]).includes(value)
  );
}

/**
 * Selects the first supported language from an HTTP language preference.
 *
 * @param preference - An `Accept-Language` value or a language code.
 * @returns The selected language, defaulting to English.
 */
export function resolveLanguage(preference: string | undefined): Language {
  if (!preference) {
    return LANGUAGE.ENGLISH;
  }

  for (const entry of preference.toLowerCase().split(",")) {
    const languageCode = entry.trim().split(";", 1)[0];

    if (languageCode === LANGUAGE.GERMAN || languageCode?.startsWith("de-")) {
      return LANGUAGE.GERMAN;
    }

    if (languageCode === LANGUAGE.ENGLISH || languageCode?.startsWith("en-")) {
      return LANGUAGE.ENGLISH;
    }
  }

  return LANGUAGE.ENGLISH;
}
