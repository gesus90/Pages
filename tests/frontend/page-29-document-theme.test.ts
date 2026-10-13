import { describe, expect, it } from "vitest";

import {
  THEME_COLORS,
  getColorSchemeMeta,
  getThemeColorMetas,
  readSubmittedTheme,
  resolveDocumentTheme,
} from "@/app/lib/document-theme";
import {
  createUserColorStyle,
  createUserTextColorStyle,
} from "@/app/lib/user-color-style";

describe("PAGE-29 color scheme meta", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "light dark"],
  ] as const)("declares %s as %j", (theme, scheme) => {
    expect(getColorSchemeMeta(theme)).toBe(scheme);
  });
});

describe("PAGE-29 browser chrome colors", () => {
  it.each(["light", "dark"] as const)(
    "gives the %s theme one color without a media query",
    (theme) => {
      expect(getThemeColorMetas(theme)).toEqual([
        { content: THEME_COLORS[theme] },
      ]);
    },
  );

  it("lets the browser pick the color of the system theme by its preference", () => {
    expect(getThemeColorMetas("system")).toEqual([
      {
        content: THEME_COLORS.light,
        media: "(prefers-color-scheme: light)",
      },
      {
        content: THEME_COLORS.dark,
        media: "(prefers-color-scheme: dark)",
      },
    ]);
  });
});

describe("PAGE-29 submitted theme", () => {
  function createForm(entries: Record<string, string>): FormData {
    const formData = new FormData();

    for (const [name, value] of Object.entries(entries)) {
      formData.set(name, value);
    }

    return formData;
  }

  it("reads the theme of a settings form", () => {
    expect(
      readSubmittedTheme(
        createForm({ intent: "update-settings", theme: "dark" }),
      ),
    ).toBe("dark");
  });

  it.each([
    ["no submission", undefined],
    ["another intent", createForm({ intent: "update-profile", theme: "dark" })],
    ["no theme", createForm({ intent: "update-settings" })],
    [
      "an unsupported theme",
      createForm({ intent: "update-settings", theme: "sepia" }),
    ],
  ])("ignores %s", (_label, formData) => {
    expect(readSubmittedTheme(formData)).toBeNull();
  });
});

describe("PAGE-29 document theme", () => {
  it("prefers a pending choice over the stored theme", () => {
    expect(resolveDocumentTheme("light", "dark")).toBe("dark");
  });

  it("uses the stored theme otherwise", () => {
    expect(resolveDocumentTheme("dark", null)).toBe("dark");
  });

  it("follows the system where nothing is known", () => {
    expect(resolveDocumentTheme(undefined, null)).toBe("system");
  });
});

describe("PAGE-29 user color style", () => {
  it("hands only the text color to the stylesheet for plain text", () => {
    expect(createUserTextColorStyle("#1e3a8a")).toEqual({
      "--chip-color": "#1e3a8a",
    });
  });

  it("hands the color to the stylesheet and tints the background", () => {
    expect(createUserColorStyle("#3b82f6", "26")).toEqual({
      "--chip-color": "#3b82f6",
      backgroundColor: "#3b82f626",
    });
  });

  it("carries the light-theme text color of colors that are too light", () => {
    expect(createUserColorStyle("#eab308", "26", "#44403c")).toEqual({
      "--chip-color": "#eab308",
      "--chip-text": "#44403c",
      backgroundColor: "#eab30826",
    });
  });
});
