import { STANDARD_DESIGN_THEME_ID } from "@/definition/DesignTheme";

import type {
  DesignThemeManifest,
  DesignThemePreviewPalette,
} from "@/definition/DesignTheme";

/**
 * The design Pages ships.
 *
 * @remarks
 * It overrides nothing: its palette is the one in `app/styles/tailwind.css`,
 * so it needs no stylesheet and its look cannot change by installing themes.
 * The colors below only draw its preview card and repeat the tokens
 * `--color-background`, `--color-sidebar`, `--color-surface`,
 * `--color-foreground`, `--color-muted-foreground`, `--color-border` and
 * `--color-primary` of both palettes. They also complete the preview of an
 * installed theme that leaves a role to the Standard design.
 */
export const STANDARD_DESIGN_THEME: DesignThemeManifest = {
  id: STANDARD_DESIGN_THEME_ID,
  name: { de: "Standard", en: "Standard" },
  description: {
    de: "Das Pages-Design mit orangem Akzent.",
    en: "The Pages design with an orange accent.",
  },
  modes: ["light", "dark"],
  colors: {},
  materials: {},
  preview: null,
};

/** The colors of the Standard design that a preview card draws, by mode. */
export const STANDARD_PREVIEW_PALETTES: Readonly<
  Record<"light" | "dark", DesignThemePreviewPalette>
> = {
  light: {
    background: "#f2f4f7",
    sidebar: "#f2f4f7",
    surface: "#ffffff",
    foreground: "#171717",
    mutedForeground: "#6d7482",
    border: "#e9ebf0",
    primary: "#f97316",
  },
  dark: {
    background: "#0f1217",
    sidebar: "#0f1217",
    surface: "#171b22",
    foreground: "#e9ebef",
    mutedForeground: "#9aa3b2",
    border: "#2a303a",
    primary: "#f97316",
  },
};
