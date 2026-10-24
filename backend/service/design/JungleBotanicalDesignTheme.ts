import { buildDesignThemeStylesheet } from "./DesignThemeStylesheet";
import { JUNGLE_BOTANICAL_MATERIALS } from "./JungleBotanicalMaterials";

import type { InstalledDesignTheme } from "./DesignThemeLoader";
import type { DesignThemeManifest } from "@/definition/DesignTheme";

/** Stable personal selection; the existing color mode chooses its palette. */
export const JUNGLE_BOTANICAL_DESIGN_THEME_ID = "jungle-botanical";

/**
 * Quiet botanical work surfaces, forest navigation and leaf-green accents.
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
      background: "#eaf3e9",
      surface: "#fbfdf9",
      "surface-hover": "#f0f7ed",
      card: "#fbfdf9",
      sidebar: "#103f35",
      "sidebar-hover": "#d8e8d1",
      "sidebar-active": "#bfe5bf",
      muted: "#e5efe2",
      foreground: "#173b30",
      "muted-foreground": "#506c58",
      border: "#d3e2ce",
      primary: "#126a50",
      "primary-hover": "#0a513d",
      "primary-subtle": "#d8edd4",
      "primary-foreground": "#ffffff",
      ring: "#126a50",
      field: "#f5f9f1",
      "field-border": "#6b8666",
      "field-border-hover": "#587751",
      "panel-body": "#f0f6ec",
      "auth-glow-warm": "#d9e7b9",
      "auth-glow-cool": "#b9ddd0",
      "auth-button-from": "#28754f",
      "auth-button-foreground": "#ffffff",
    },
    dark: {
      background: "#0b1915",
      surface: "#142c23",
      "surface-hover": "#1b382c",
      card: "#142c23",
      sidebar: "#103f35",
      "sidebar-hover": "#245b48",
      "sidebar-active": "#bfe5bf",
      muted: "#19382d",
      foreground: "#e2f0df",
      "muted-foreground": "#b0c6ad",
      border: "#304e3e",
      primary: "#b9dc8d",
      "primary-hover": "#ceeaa6",
      "primary-subtle": "#294832",
      "primary-foreground": "#102516",
      ring: "#b9dc8d",
      field: "#0d2019",
      "field-border": "#789973",
      "field-border-hover": "#8eb280",
      "panel-body": "#10251d",
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
