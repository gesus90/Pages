import { buildDesignThemeStylesheet } from "./DesignThemeStylesheet";

import type { InstalledDesignTheme } from "./DesignThemeLoader";
import type { ShippedDesignThemeDeclarations } from "./DesignThemeStylesheet";
import type { DesignThemeManifest } from "@/definition/DesignTheme";

/** Identifier of the Arctic Ice design; it is stored in the settings of a user. */
export const ARCTIC_ICE_DESIGN_THEME_ID = "arctic-ice";

/**
 * The maritime ice-glass design: white and blue by day, deep polar sea at night.
 *
 * @remarks
 * One theme with two palettes. The color mode of the user picks the palette,
 * so there is no second theme for the dark one. Text colors are chosen so
 * that every text token reaches 4.5:1 on every surface of its palette,
 * including the darkest spot of the sidebar texture; the field borders and
 * the focus ring reach 3:1. The status, priority, workflow and plan colors
 * are not roles of a theme and keep their meaning.
 */
export const ARCTIC_ICE_DESIGN_THEME: DesignThemeManifest = {
  id: ARCTIC_ICE_DESIGN_THEME_ID,
  name: { de: "Arctic Ice", en: "Arctic Ice" },
  description: {
    de: "Maritimes Eisglas in Weiß und Blau, dunkel als tiefes Polarmeer.",
    en: "Maritime ice glass in white and blue, dark as the deep polar sea.",
  },
  modes: ["light", "dark"],
  colors: {
    light: {
      background: "#edf5fb",
      surface: "#ffffff",
      "surface-hover": "#f4f9fd",
      card: "#ffffff",
      sidebar: "#dceefb",
      "sidebar-hover": "#cfe5f8",
      "sidebar-active": "#cce6fc",
      muted: "#edf4fa",
      foreground: "#142f4d",
      "muted-foreground": "#4a627c",
      border: "#dce8f2",
      primary: "#165bb8",
      "primary-hover": "#104b9c",
      "primary-subtle": "#e2efff",
      "primary-foreground": "#ffffff",
      ring: "#165bb8",
      field: "#f8fbfe",
      "field-border": "#7794b0",
      "field-border-hover": "#5f7f9f",
      "panel-body": "#f2f7fb",
      "auth-glow-warm": "#d7edfc",
      "auth-glow-cool": "#dceafc",
      "auth-button-from": "#2f74c8",
      "auth-button-foreground": "#ffffff",
    },
    dark: {
      background: "#0b1828",
      surface: "#14283d",
      "surface-hover": "#1b354e",
      card: "#14283d",
      sidebar: "#14334f",
      "sidebar-hover": "#234963",
      "sidebar-active": "#2b506e",
      muted: "#102235",
      foreground: "#e5f2fd",
      "muted-foreground": "#b0c9de",
      border: "#304b64",
      primary: "#8bcdf4",
      "primary-hover": "#b2e1fc",
      "primary-subtle": "#1a3c58",
      "primary-foreground": "#08253b",
      ring: "#8bcdf4",
      field: "#0e2032",
      "field-border": "#58798f",
      "field-border-hover": "#789ab6",
      "panel-body": "#0f2134",
      "auth-glow-warm": "#143b59",
      "auth-glow-cool": "#1a3453",
      "auth-button-from": "#a4ddfc",
      "auth-button-foreground": "#08253b",
    },
  },
  materials: {},
  preview: null,
};

/** Colors of the four bands of the sidebar texture, from the top band down. */
type SidebarBandColors = readonly [string, string, string, string];

/**
 * Four soft bands across the sidebar over a gentle diagonal gradient.
 *
 * @remarks
 * The waves only show up as a hint: static gradients, no image, no blur and
 * no animation. The first and third band rise from the left edge in a light
 * tone, the second and fourth from the right edge in a darker one, so the
 * material feels strongest on the left. Content surfaces never carry the
 * texture; text on it keeps its contrast even on the darkest band.
 */
function sidebarTexture(bands: SidebarBandColors, base: string): string {
  const [first, second, third, fourth] = bands;

  return [
    `radial-gradient(ellipse 150% 22% at -12% 17%, ${first}, transparent 72%)`,
    `radial-gradient(ellipse 180% 20% at 116% 35%, ${second}, transparent 72%)`,
    `radial-gradient(ellipse 165% 19% at -24% 58%, ${third}, transparent 73%)`,
    `radial-gradient(ellipse 160% 24% at 104% 80%, ${fourth}, transparent 72%)`,
    base,
  ].join(", ");
}

const SHIPPED_DECLARATIONS: ShippedDesignThemeDeclarations = {
  light: [
    "--shadow-ink: 37 83 124;",
    "--shadow-auth-button: 0 10px 24px -8px rgb(22 91 184 / 32%);",
    `--sidebar-texture: ${sidebarTexture(
      [
        "rgb(255 255 255 / 74%)",
        "rgb(184 220 246 / 52%)",
        "rgb(255 255 255 / 66%)",
        "rgb(183 220 246 / 40%)",
      ],
      "linear-gradient(156deg, #e9f5fd 0%, #d6eafb 52%, #e7f3fc 100%)",
    )};`,
    "--sidebar-edge: inset -1px 0 0 #d0e4f3, inset -2px 0 0 rgb(255 255 255 / 75%);",
  ],
  dark: [
    "--shadow-ink: 0 8 18;",
    "--shadow-auth-button: 0 10px 24px -8px rgb(79 163 221 / 25%);",
    `--sidebar-texture: ${sidebarTexture(
      [
        "rgb(206 232 251 / 11%)",
        "rgb(97 162 209 / 13%)",
        "rgb(222 243 255 / 8%)",
        "rgb(90 153 205 / 9%)",
      ],
      "linear-gradient(156deg, #193d59 0%, #102b44 52%, #173650 100%)",
    )};`,
    "--sidebar-edge: inset -1px 0 0 #34536b, inset -2px 0 0 rgb(203 232 253 / 7%);",
  ],
};

/** Arctic Ice as the registry serves it: always installed, never read from disk. */
export const ARCTIC_ICE_INSTALLED_THEME: InstalledDesignTheme = {
  manifest: ARCTIC_ICE_DESIGN_THEME,
  previewImagePath: null,
  signature: ARCTIC_ICE_DESIGN_THEME_ID,
  stylesheet: buildDesignThemeStylesheet(
    ARCTIC_ICE_DESIGN_THEME,
    SHIPPED_DECLARATIONS,
  ),
};
