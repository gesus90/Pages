import { LANGUAGE } from "@/language/Language";

import type { Language } from "@/language/Language";

/** Identifier of the design Pages ships; it is always installed and cannot be removed. */
export const STANDARD_DESIGN_THEME_ID = "standard";

/** Longest identifier a design theme may have. */
export const MAXIMUM_DESIGN_THEME_ID_LENGTH = 40;

const DESIGN_THEME_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/**
 * Tells whether a value can be the identifier of a design theme.
 *
 * @param value - Candidate from a file name, a manifest or a form.
 * @returns Whether it is lower-case words joined by hyphens that begin with a
 * letter. Such a name is also safe as a directory name and in a selector.
 */
export function isDesignThemeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAXIMUM_DESIGN_THEME_ID_LENGTH &&
    DESIGN_THEME_ID_PATTERN.test(value)
  );
}

/** Color modes a design theme can support; the user's mode setting picks one. */
export const DESIGN_THEME_MODES = ["light", "dark"] as const;

/** A color mode a design theme can support. */
export type DesignThemeMode = (typeof DESIGN_THEME_MODES)[number];

/**
 * Color roles a manifest may set, named like the color tokens of the stylesheet.
 *
 * @remarks
 * A role overrides the token `--color-<role>`. Roles that are not listed
 * keep the value of the Standard design.
 */
export const DESIGN_THEME_COLOR_ROLES = [
  "background",
  "surface",
  "surface-hover",
  "card",
  "sidebar",
  "sidebar-hover",
  "muted",
  "foreground",
  "muted-foreground",
  "border",
  "primary",
  "primary-hover",
  "primary-subtle",
  "primary-foreground",
  "ring",
] as const;

/** A color role a manifest may set. */
export type DesignThemeColorRole = (typeof DESIGN_THEME_COLOR_ROLES)[number];

/** Colors of one mode by role, each a hexadecimal color. */
export type DesignThemePalette = Readonly<
  Partial<Record<DesignThemeColorRole, string>>
>;

/**
 * Material roles of a manifest: the character of surfaces, independent of the mode.
 *
 * @remarks
 * `radiusScale` multiplies every corner radius, `shadowStrength` multiplies
 * the opacity of every shadow and `shadowEdgeAlpha` is the opacity in percent
 * of the hairline edge that raised surfaces get.
 */
export interface DesignThemeMaterials {
  readonly radiusScale?: number;
  readonly shadowStrength?: number;
  readonly shadowEdgeAlpha?: number;
}

/** A text in both languages of Pages. */
export type LocalizedText = Readonly<Record<Language, string>>;

/**
 * The validated description of a design theme.
 *
 * @remarks
 * The same shape is read from `theme.json` of an installed theme; the
 * Standard design is defined in code.
 */
export interface DesignThemeManifest {
  readonly id: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly modes: readonly DesignThemeMode[];
  readonly colors: Readonly<
    Partial<Record<DesignThemeMode, DesignThemePalette>>
  >;
  readonly materials: DesignThemeMaterials;
  /** File name of the preview image inside the theme directory, if there is one. */
  readonly preview: string | null;
}

/** Colors a preview card draws, taken from the palette of one mode. */
export interface DesignThemePreviewPalette {
  readonly background: string;
  readonly sidebar: string;
  readonly surface: string;
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly primary: string;
}

/** One theme as the settings page offers it. */
export interface DesignThemeChoice {
  readonly id: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly modes: readonly DesignThemeMode[];
  /** What a preview card draws for each supported mode. */
  readonly preview: Readonly<
    Partial<Record<DesignThemeMode, DesignThemePreviewPalette>>
  >;
  /** Address of the preview image; the card draws a mock-up without one. */
  readonly previewImageUrl: string | null;
}

/** An installed directory whose manifest was not accepted, with the reason. */
export interface SkippedDesignTheme {
  readonly directory: string;
  readonly reason: string;
}

/** The design theme a document is rendered in. */
export interface ActiveDesignTheme {
  readonly id: string;
  /** Stylesheet that applies the theme; `null` for the Standard design, which needs none. */
  readonly stylesheet: string | null;
}

/** The design every visitor gets until a signed-in user has chosen another one. */
export const STANDARD_ACTIVE_DESIGN_THEME: ActiveDesignTheme = {
  id: STANDARD_DESIGN_THEME_ID,
  stylesheet: null,
};

/** Everything the appearance settings need to offer the themes. */
export interface DesignThemeSelection {
  /** The theme in effect, after the fallback to the Standard design. */
  readonly selectedId: string;
  readonly choices: readonly DesignThemeChoice[];
  /** Directories that were not accepted; only administrators receive them. */
  readonly skipped: readonly SkippedDesignTheme[];
}

/**
 * Picks the text of a language.
 *
 * @param text - A text in both languages.
 * @param language - Language to show; any other value falls back to English.
 * @returns The text in that language.
 */
export function pickLocalizedText(
  text: LocalizedText,
  language: string,
): string {
  return language === LANGUAGE.GERMAN
    ? text[LANGUAGE.GERMAN]
    : text[LANGUAGE.ENGLISH];
}
