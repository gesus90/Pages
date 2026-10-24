import { buildDesignThemeStylesheet } from "./DesignThemeStylesheet";
import { NEURAL_RGB_MATERIALS } from "./NeuralRgbMaterials";

import type { InstalledDesignTheme } from "./DesignThemeLoader";
import type { DesignThemeManifest } from "@/definition/DesignTheme";

/** One personal theme identifier; the existing color mode selects its palette. */
export const NEURAL_RGB_DESIGN_THEME_ID = "neural-rgb";

/** Graphite work surfaces, cyan actions and quiet circuit navigation. */
export const NEURAL_RGB_DESIGN_THEME: DesignThemeManifest = {
  id: NEURAL_RGB_DESIGN_THEME_ID,
  name: { de: "Neural RGB", en: "Neural RGB" },
  description: {
    de: "Cyan, Violett und dezente Leiterbahnen. Hell und Dunkel in einem Design.",
    en: "Cyan, violet and subtle circuits. Light and dark in one design.",
  },
  modes: ["light", "dark"],
  colors: {
    light: {
      background: "#f2f4fa",
      surface: "#ffffff",
      "surface-hover": "#edf3fa",
      card: "#ffffff",
      sidebar: "#e9eef7",
      "sidebar-hover": "#dce5f3",
      "sidebar-active": "#d5dced",
      muted: "#e8edf6",
      foreground: "#172139",
      "muted-foreground": "#55617c",
      border: "#d6dfed",
      primary: "#007489",
      "primary-hover": "#005c73",
      "primary-subtle": "#e3f3f7",
      "primary-foreground": "#ffffff",
      ring: "#6159b7",
      field: "#f8faff",
      "field-border": "#7889a6",
      "field-border-hover": "#596f91",
      "panel-body": "#edf1f8",
      "auth-glow-warm": "#dfd9f3",
      "auth-glow-cool": "#d7edf2",
      "auth-button-from": "#007489",
      "auth-button-foreground": "#ffffff",
    },
    dark: {
      background: "#090d16",
      surface: "#141b29",
      "surface-hover": "#1c2638",
      card: "#141b29",
      sidebar: "#0d1220",
      "sidebar-hover": "#1a2439",
      "sidebar-active": "#242b46",
      muted: "#232d41",
      foreground: "#eaf0ff",
      "muted-foreground": "#a2b0c9",
      border: "#2b354c",
      primary: "#63dce9",
      "primary-hover": "#98ebf2",
      "primary-subtle": "#152f40",
      "primary-foreground": "#0b1725",
      ring: "#8bafff",
      field: "#101827",
      "field-border": "#6e82a4",
      "field-border-hover": "#91a8ca",
      "panel-body": "#101724",
      "auth-glow-warm": "#423662",
      "auth-glow-cool": "#1c4559",
      "auth-button-from": "#7ae3ed",
      "auth-button-foreground": "#0b1725",
    },
  },
  materials: { shadowStrength: 1, shadowEdgeAlpha: 20 },
  preview: null,
};

/** Built-in theme, served through the same registry and preference as other designs. */
export const NEURAL_RGB_INSTALLED_THEME: InstalledDesignTheme = {
  manifest: NEURAL_RGB_DESIGN_THEME,
  previewImagePath: null,
  signature: NEURAL_RGB_DESIGN_THEME_ID,
  stylesheet: buildDesignThemeStylesheet(
    NEURAL_RGB_DESIGN_THEME,
    NEURAL_RGB_MATERIALS,
  ),
};
