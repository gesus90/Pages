import { buildDesignThemeStylesheet } from "./DesignThemeStylesheet";
import { KOI_GARDEN_MATERIALS } from "./KoiGardenMaterials";

import type { InstalledDesignTheme } from "./DesignThemeLoader";
import type { DesignThemeManifest } from "@/definition/DesignTheme";

/** One personal theme identifier; the existing color mode selects its palette. */
export const KOI_GARDEN_DESIGN_THEME_ID = "koi-garden";

/**
 * Lilac work surfaces in front of an impressionist koi pond and a sage-green
 * navigation: morning light in light mode, a moonlit night in dark mode.
 * Status, priority, avatar and user colors stay independent.
 */
export const KOI_GARDEN_DESIGN_THEME: DesignThemeManifest = {
  id: KOI_GARDEN_DESIGN_THEME_ID,
  name: { de: "Koi Garden", en: "Koi Garden" },
  description: {
    de: "Impressionistischer Koi-Teich in Salbei und Flieder.",
    en: "An impressionist koi pond in sage and lilac.",
  },
  modes: ["light", "dark"],
  colors: {
    light: {
      background: "#eeedf6",
      surface: "#fbfaff",
      "surface-hover": "#eceaf5",
      card: "#fbfaff",
      sidebar: "#2f5145",
      "sidebar-hover": "#e6e4f2",
      "sidebar-active": "#44705f",
      muted: "#eceaf5",
      foreground: "#2b2d4a",
      "muted-foreground": "#5b5d7c",
      border: "#dcd9ea",
      primary: "#5a5fb0",
      "primary-hover": "#4a4f9c",
      "primary-subtle": "#e7e6f7",
      "primary-foreground": "#ffffff",
      ring: "#5a5fb0",
      field: "#fbfaff",
      // Stronger than the drawn #aaa9c4, so field edges reach 3:1 on cards.
      "field-border": "#8584a6",
      "field-border-hover": "#6d6c92",
      "panel-body": "#f6f4fc",
      "auth-glow-warm": "#e3dcf3",
      "auth-glow-cool": "#d3e6dc",
      "auth-button-from": "#5a5fb0",
      "auth-button-foreground": "#ffffff",
    },
    dark: {
      background: "#12142a",
      surface: "#1b1e36",
      "surface-hover": "#262a48",
      card: "#1b1e36",
      sidebar: "#15261f",
      "sidebar-hover": "#1c2040",
      "sidebar-active": "#2c4a3e",
      muted: "#262a48",
      foreground: "#eceafa",
      "muted-foreground": "#aeb0cf",
      border: "#2f3355",
      primary: "#b2b4f0",
      "primary-hover": "#c6c8f6",
      "primary-subtle": "#2f3260",
      "primary-foreground": "#171935",
      ring: "#b2b4f0",
      field: "#171a30",
      // Stronger than the drawn #565a85, so field edges reach 3:1 on cards.
      "field-border": "#7175a3",
      "field-border-hover": "#8a8ebb",
      "panel-body": "#171a30",
      "auth-glow-warm": "#2f2b55",
      "auth-glow-cool": "#1d3a30",
      "auth-button-from": "#b2b4f0",
      "auth-button-foreground": "#171935",
    },
  },
  materials: {},
  preview: null,
};

/** Built-in theme, available even when no local themes directory exists. */
export const KOI_GARDEN_INSTALLED_THEME: InstalledDesignTheme = {
  manifest: KOI_GARDEN_DESIGN_THEME,
  previewImagePath: null,
  signature: KOI_GARDEN_DESIGN_THEME_ID,
  stylesheet: buildDesignThemeStylesheet(
    KOI_GARDEN_DESIGN_THEME,
    KOI_GARDEN_MATERIALS,
  ),
};
