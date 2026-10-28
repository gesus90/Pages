import { expect, it } from "vitest";

import {
  getColorSchemeMeta,
  getThemeColorMetas,
  readSubmittedTheme,
  resolveDocumentTheme,
  THEME_COLORS,
} from "@/app/lib/document-theme";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";

/** Form data of a pending navigation with the given fields. */
function form(fields: Readonly<Record<string, string>>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

it("declares the color schemes of each theme", () => {
  expect(getColorSchemeMeta("light")).toBe("light");
  expect(getColorSchemeMeta("dark")).toBe("dark");
  expect(getColorSchemeMeta("system")).toBe("light dark");
});

it("builds one theme color for an explicit theme and one per scheme for the system theme", () => {
  expect(getThemeColorMetas("dark")).toEqual([{ content: THEME_COLORS.dark }]);
  expect(getThemeColorMetas("light")).toEqual([
    { content: THEME_COLORS.light },
  ]);
  expect(getThemeColorMetas("system")).toEqual([
    { content: THEME_COLORS.light, media: "(prefers-color-scheme: light)" },
    { content: THEME_COLORS.dark, media: "(prefers-color-scheme: dark)" },
  ]);
});

it("reads the theme of a pending settings form only", () => {
  expect(
    readSubmittedTheme(form({ intent: "update-settings", theme: "dark" })),
  ).toBe("dark");
  expect(
    readSubmittedTheme(form({ intent: "update-settings", theme: "neon" })),
  ).toBeNull();
  expect(readSubmittedTheme(form({ intent: "update-settings" }))).toBeNull();
  expect(
    readSubmittedTheme(form({ intent: "update-profile", theme: "dark" })),
  ).toBeNull();
  expect(readSubmittedTheme(undefined)).toBeNull();
});

it("prefers the submitted theme, then the stored one, then the default", () => {
  expect(resolveDocumentTheme("light", "dark")).toBe("dark");
  expect(resolveDocumentTheme("light", null)).toBe("light");
  expect(resolveDocumentTheme(undefined, null)).toBe(
    DEFAULT_USER_SETTINGS.theme,
  );
});
