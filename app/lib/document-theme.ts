import { DEFAULT_USER_SETTINGS, isUserTheme } from "@/definition/Settings";

import type { UserTheme } from "@/definition/Settings";

/**
 * Colors of the browser chrome (address bar, mobile status bar).
 *
 * @remarks
 * A `meta` tag cannot read a CSS custom property, so these two values repeat
 * the `--color-surface` of the light palette and the `--color-background` of
 * the dark palette in `app/styles/tailwind.css`; a test keeps them equal.
 */
export const THEME_COLORS = {
  dark: "#0f1217",
  light: "#ffffff",
} as const;

/** The `color-scheme` the document declares before its stylesheet applies. */
const COLOR_SCHEME_BY_THEME: Readonly<Record<UserTheme, string>> = {
  dark: "dark",
  light: "light",
  system: "light dark",
};

/** One `theme-color` meta tag of the document head. */
export interface ThemeColorMeta {
  readonly content: string;
  /** Media query that selects the tag, set only while the system decides. */
  readonly media?: string;
}

/**
 * Names the color schemes the document supports for a theme.
 *
 * @param theme - The theme the document is rendered in.
 * @returns The `content` of the `color-scheme` meta tag.
 */
export function getColorSchemeMeta(theme: UserTheme): string {
  return COLOR_SCHEME_BY_THEME[theme];
}

/**
 * Builds the `theme-color` meta tags for a theme.
 *
 * @param theme - The theme the document is rendered in.
 * @returns One tag for an explicit theme; one tag per scheme for `system`,
 * so the browser picks the one that matches the operating system.
 */
export function getThemeColorMetas(theme: UserTheme): ThemeColorMeta[] {
  if (theme === "system") {
    return [
      { content: THEME_COLORS.light, media: "(prefers-color-scheme: light)" },
      { content: THEME_COLORS.dark, media: "(prefers-color-scheme: dark)" },
    ];
  }

  return [{ content: THEME_COLORS[theme] }];
}

/**
 * Reads the theme of a settings form that is being submitted.
 *
 * @param formData - Form data of the pending navigation, if any.
 * @returns The submitted theme, or `null` when no settings form is pending.
 */
export function readSubmittedTheme(
  formData: FormData | undefined,
): UserTheme | null {
  if (formData?.get("intent") !== "update-settings") {
    return null;
  }

  const theme = formData.get("theme");

  return isUserTheme(theme) ? theme : null;
}

/**
 * Chooses the theme a document is rendered in.
 *
 * @param storedTheme - Theme the root loader returned, if there is loader data.
 * @param submittedTheme - Theme of a settings form that is still being saved.
 * @returns The submitted theme first, then the stored one, then the default.
 */
export function resolveDocumentTheme(
  storedTheme: UserTheme | undefined,
  submittedTheme: UserTheme | null,
): UserTheme {
  return submittedTheme ?? storedTheme ?? DEFAULT_USER_SETTINGS.theme;
}
