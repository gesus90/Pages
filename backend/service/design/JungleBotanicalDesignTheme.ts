import { buildDesignThemeStylesheet } from "./DesignThemeStylesheet";
import { JUNGLE_BOTANICAL_MATERIALS } from "./JungleBotanicalMaterials";

import type { InstalledDesignTheme } from "./DesignThemeLoader";
import type { DesignThemeManifest } from "@/definition/DesignTheme";

/** Stable personal selection; the existing color mode chooses its palette. */
export const JUNGLE_BOTANICAL_DESIGN_THEME_ID = "jungle-botanical";

/**
 * Calm neutral work surfaces, a deep forest navigation and moss-green accents.
 * Semantic workflow, status, priority, avatar and user colors stay independent.
 */
export const JUNGLE_BOTANICAL_DESIGN_THEME: DesignThemeManifest = {
  id: JUNGLE_BOTANICAL_DESIGN_THEME_ID,
  name: { de: "Jungle Botanical", en: "Jungle Botanical" },
  description: {
    de: "Botanische Farben und Blattmotive. Hell und Dunkel in einem Design.",
    en: "Botanical colors and leaf motifs. Light and dark in one design.",
  },
  modes: ["light", "dark"],
  colors: {
    light: {
      background: "#f3f2ea",
      surface: "#fdfcf8",
      "surface-hover": "#efeee5",
      card: "#fdfcf8",
      sidebar: "#1a3229",
      "sidebar-hover": "#e8e7dc",
      "sidebar-active": "#2d4c40",
      muted: "#efeee5",
      foreground: "#1f2f29",
      "muted-foreground": "#5b6b62",
      border: "#e2e0d4",
      primary: "#2c6049",
      "primary-hover": "#224c3a",
      "primary-subtle": "#e2ece0",
      "primary-foreground": "#ffffff",
      ring: "#2c6049",
      field: "#fdfcf8",
      "field-border": "#8a9183",
      "field-border-hover": "#6f776a",
      "panel-body": "#f7f6ef",
      "auth-glow-warm": "#d9e7b9",
      "auth-glow-cool": "#b9ddd0",
      "auth-button-from": "#28754f",
      "auth-button-foreground": "#ffffff",
    },
    dark: {
      background: "#0e1412",
      surface: "#171f1b",
      "surface-hover": "#1e2723",
      card: "#171f1b",
      sidebar: "#101815",
      "sidebar-hover": "#1e2723",
      "sidebar-active": "#223029",
      muted: "#1e2723",
      foreground: "#e8ede5",
      "muted-foreground": "#a3afa4",
      border: "#27312c",
      primary: "#a9c78f",
      "primary-hover": "#bcd5a6",
      "primary-subtle": "#26342b",
      "primary-foreground": "#141c14",
      ring: "#a9c78f",
      field: "#131a17",
      "field-border": "#5d6c63",
      "field-border-hover": "#75857b",
      "panel-body": "#131a17",
      "auth-glow-warm": "#314527",
      "auth-glow-cool": "#204539",
      "auth-button-from": "#a3ca7d",
      "auth-button-foreground": "#102516",
    },
  },
  materials: {},
  preview: null,
};

/** Built-in theme, available even when no local themes directory exists. */
export const JUNGLE_BOTANICAL_INSTALLED_THEME: InstalledDesignTheme = {
  manifest: JUNGLE_BOTANICAL_DESIGN_THEME,
  previewImagePath: null,
  signature: JUNGLE_BOTANICAL_DESIGN_THEME_ID,
  stylesheet: buildDesignThemeStylesheet(
    JUNGLE_BOTANICAL_DESIGN_THEME,
    JUNGLE_BOTANICAL_MATERIALS,
  ),
};
