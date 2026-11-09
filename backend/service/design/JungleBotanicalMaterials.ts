import {
  BOTANICAL_NAVIGATION_TEXTURE,
  BOTANICAL_AUTH_CORNER,
  BOTANICAL_AUTH_LOWER_CORNER,
} from "./JungleBotanicalArtwork";

import type { ShippedDesignThemeDeclarations } from "./DesignThemeStylesheet";

interface NavigationPalette {
  readonly surface: string;
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly icon: string;
  readonly iconHover: string;
  readonly edge: string;
  readonly hover: string;
  readonly muted: string;
  readonly field: string;
  readonly fieldBorder: string;
  readonly fieldBorderHover: string;
  readonly activeSurface: string;
  readonly activeHover: string;
  readonly activeForeground: string;
  readonly activeIcon: string;
}

/** The deep navigation of one palette, including the mobile sheet. */
function navigationDeclarations(palette: NavigationPalette): string[] {
  return [
    `--navigation-foreground: ${palette.foreground};`,
    `--navigation-muted-foreground: ${palette.mutedForeground};`,
    `--navigation-primary: ${palette.icon};`,
    `--navigation-primary-hover: ${palette.iconHover};`,
    `--navigation-primary-subtle: ${palette.activeSurface};`,
    `--navigation-primary-foreground: ${palette.surface};`,
    `--navigation-active-foreground: ${palette.activeForeground};`,
    `--navigation-active-muted-foreground: ${palette.activeForeground};`,
    `--navigation-active-icon: ${palette.activeIcon};`,
    `--navigation-active-hover: ${palette.activeHover};`,
    `--navigation-active-muted: ${palette.activeHover};`,
    `--navigation-active-surface-hover: ${palette.activeHover};`,
    `--navigation-focus: ${palette.activeIcon};`,
    `--navigation-muted: ${palette.muted};`,
    `--navigation-surface: ${palette.surface};`,
    `--navigation-surface-hover: ${palette.hover};`,
    `--navigation-hover: ${palette.hover};`,
    `--navigation-background: ${palette.surface};`,
    `--navigation-border: ${palette.edge};`,
    `--navigation-field: ${palette.field};`,
    `--navigation-field-border: ${palette.fieldBorder};`,
    `--navigation-field-border-hover: ${palette.fieldBorderHover};`,
    `--navigation-scrollbar-thumb: ${palette.fieldBorder};`,
    `--navigation-scrollbar-thumb-hover: ${palette.fieldBorderHover};`,
    "--navigation-selection-edge-width: 0px;",
    "--navigation-selection-edge-offset: 2px;",
    "--navigation-selection-shadow: 0 0 #0000;",
    "--navigation-logo-surface: transparent;",
    "--navigation-logo-edge: none;",
    "--navigation-logo-filter: brightness(0) invert(94%) sepia(14%) saturate(380%) hue-rotate(42deg);",
    "--sidebar-texture: none;",
    `--sidebar-edge: inset -1px 0 0 ${palette.edge};`,
    "--sidebar-foliage-display: block;",
    `--sidebar-foliage: ${BOTANICAL_NAVIGATION_TEXTURE};`,
    // Anchored to the lower edges, so a short or wide sheet keeps the leaves
    // at the sides instead of moving them behind the menu items.
    "--sidebar-foliage-size: cover;",
    "--sidebar-foliage-position: center bottom;",
    "--sidebar-foliage-mask: linear-gradient(to bottom, transparent 42%, #000 68%);",
  ];
}

/** Materials both palettes share; the colors come from the palette. */
const SHARED_DECLARATIONS = [
  "--auth-glow-opacity: 0;",
  "--field-edge-width: 1px;",
  "--selection-edge-width: 1px;",
  "--color-control-border: var(--color-field-border);",
  "--color-placeholder-foreground: var(--color-muted-foreground);",
  "--color-toggle-thumb: var(--color-muted-foreground);",
  "--color-toggle-thumb-active: var(--color-primary-foreground);",
  "--scrollbar-thumb: var(--color-field-border);",
  "--scrollbar-thumb-hover: var(--color-field-border-hover);",
  "--color-trend-positive: var(--color-success);",
  "--shadow-auth-button: 0 10px 24px -8px rgb(18 106 80 / 30%);",
];

/** Palette-specific materials, applied through the existing document theme. */
export const JUNGLE_BOTANICAL_MATERIALS: ShippedDesignThemeDeclarations = {
  light: [
    ...SHARED_DECLARATIONS,
    ...navigationDeclarations({
      surface: "#1a3229",
      foreground: "#e8eee4",
      mutedForeground: "#b5c4b9",
      icon: "#a3b6a9",
      iconHover: "#c9e0b2",
      edge: "#264238",
      hover: "#213b31",
      muted: "#213b31",
      field: "#1f382e",
      fieldBorder: "#5a7869",
      fieldBorderHover: "#73907f",
      activeSurface: "#2d4c40",
      activeHover: "#335446",
      activeForeground: "#f4f6ec",
      activeIcon: "#c9e0b2",
    }),
    "--sidebar-foliage-opacity: 0.78;",
    "--shadow-ink: 31 47 41;",
    "--card-material-edge: 0 0 0 1px var(--color-border);",
    "--card-texture: linear-gradient(#f7f6ef, var(--color-card) min(60%, 14rem));",
    "--page-texture: radial-gradient(ellipse 60% 70% at 100% 0%, #ebeee2, transparent 70%);",
    "--user-color-text-max-lightness: 0.48;",
    "--auth-footer-surface: #edf6e7;",
    `--auth-stage-texture: ${BOTANICAL_AUTH_CORNER}, ${BOTANICAL_AUTH_LOWER_CORNER}, linear-gradient(145deg, #eff6e9, #dfeedd);`,
  ],
  dark: [
    ...SHARED_DECLARATIONS,
    ...navigationDeclarations({
      surface: "#101815",
      foreground: "#d9e2d6",
      mutedForeground: "#a0aea3",
      icon: "#8fa394",
      iconHover: "#b4d198",
      edge: "#222c27",
      hover: "#19231f",
      muted: "#19231f",
      field: "#141d19",
      fieldBorder: "#46554c",
      fieldBorderHover: "#5d6c63",
      activeSurface: "#223029",
      activeHover: "#28382f",
      activeForeground: "#eaf1e0",
      activeIcon: "#b4d198",
    }),
    "--sidebar-foliage-opacity: 0.72;",
    "--shadow-ink: 0 0 0;",
    "--card-material-edge: 0 0 0 1px var(--color-border), 0 18px 40px -22px rgb(0 0 0 / 60%);",
    "--card-texture: linear-gradient(#1b2520, var(--color-card) min(60%, 14rem));",
    "--page-texture: radial-gradient(ellipse 60% 70% at 100% 0%, #141d19, transparent 70%);",
    "--color-plan-progress-label: #0e1412;",
    "--color-plan-progress-shade: var(--color-foreground);",
    "--auth-footer-surface: #0d201a;",
    `--auth-stage-texture: ${BOTANICAL_AUTH_CORNER}, ${BOTANICAL_AUTH_LOWER_CORNER}, linear-gradient(145deg, #0d201a, #081610);`,
  ],
};
