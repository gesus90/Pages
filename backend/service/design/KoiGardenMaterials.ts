import type { ShippedDesignThemeDeclarations } from "./DesignThemeStylesheet";

interface NavigationPalette {
  readonly surface: string;
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly icon: string;
  readonly edge: string;
  readonly hover: string;
  readonly field: string;
  readonly fieldBorder: string;
  readonly fieldBorderHover: string;
  readonly activeSurface: string;
  readonly activeHover: string;
  readonly activeForeground: string;
  readonly activeIcon: string;
}

/** The sage navigation of one palette, including the mobile sheet. */
function navigationDeclarations(palette: NavigationPalette): string[] {
  return [
    `--navigation-foreground: ${palette.foreground};`,
    `--navigation-muted-foreground: ${palette.mutedForeground};`,
    `--navigation-primary: ${palette.icon};`,
    `--navigation-primary-hover: ${palette.activeIcon};`,
    `--navigation-primary-subtle: ${palette.activeSurface};`,
    `--navigation-primary-foreground: ${palette.surface};`,
    `--navigation-active-foreground: ${palette.activeForeground};`,
    `--navigation-active-muted-foreground: ${palette.activeForeground};`,
    `--navigation-active-icon: ${palette.activeIcon};`,
    `--navigation-active-hover: ${palette.activeHover};`,
    `--navigation-active-muted: ${palette.activeHover};`,
    `--navigation-active-surface-hover: ${palette.activeHover};`,
    `--navigation-focus: ${palette.activeIcon};`,
    `--navigation-muted: ${palette.hover};`,
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
    // A 2 px edge in the icon color at the left of the active item.
    "--navigation-selection-edge-width: 0px;",
    "--navigation-selection-edge-offset: 2px;",
    `--navigation-selection-shadow: 0 0 0 1px color-mix(in srgb, ${palette.activeIcon} 30%, transparent);`,
    "--navigation-logo-surface: transparent;",
    "--navigation-logo-edge: none;",
    "--navigation-logo-filter: brightness(0) invert(97%) sepia(6%) saturate(300%) hue-rotate(200deg);",
    "--sidebar-texture: none;",
    `--sidebar-edge: inset -1px 0 0 ${palette.edge}, 8px 0 30px -14px rgb(20 20 60 / 35%);`,
  ];
}

/**
 * The paintings both palettes share; their addresses live in `materials.css`,
 * so the bundler processes them and only this design loads them.
 */
const SHARED_DECLARATIONS = [
  "--app-scene-display: block;",
  "--app-scene-isolation: isolate;",
  "--sidebar-scene-display: block;",
  "--sidebar-scene-fill: #5d8763;",
  // The painting fills the space below a short tree instead of the tree.
  "--sidebar-tree-flex: 0 1 auto;",
  // A resting sticky heading lets the painting through; stuck, it covers.
  "--sticky-band-rest-opacity: 0;",
  // Text without a surface of its own stays readable where the painting shows.
  "--scene-veil-filter: blur(8px);",
  "--auth-glow-opacity: 0;",
  "--field-edge-width: 1px;",
  "--selection-edge-width: 1px;",
  "--color-control-border: var(--color-field-border);",
  "--color-placeholder-foreground: var(--color-muted-foreground);",
  "--color-toggle-thumb-active: var(--color-primary-foreground);",
  "--scrollbar-thumb: var(--color-field-border);",
  "--scrollbar-thumb-hover: var(--color-field-border-hover);",
  "--color-trend-positive: var(--color-success);",
];

/** The moonlit variant darkens only the painting, never a color role. */
const NIGHT_FILTER = "brightness(0.74) saturate(1.22) contrast(1.12)";

/** Palette-specific materials, applied through the existing document theme. */
export const KOI_GARDEN_MATERIALS: ShippedDesignThemeDeclarations = {
  light: [
    ...SHARED_DECLARATIONS,
    ...navigationDeclarations({
      surface: "#2f5145",
      foreground: "#f2f7f2",
      mutedForeground: "#d3e3d9",
      icon: "#c2d6ca",
      edge: "#426658",
      hover: "#3a5f52",
      field: "#355a4d",
      fieldBorder: "#6f9283",
      fieldBorderHover: "#88a99a",
      activeSurface: "#44705f",
      activeHover: "#4b7a68",
      activeForeground: "#ffffff",
      activeIcon: "#f8cbab",
    }),
    "--app-scene-filter: none;",
    "--app-scene-wash-color: 240 239 248;",
    "--app-scene-tint: transparent;",
    "--sidebar-scene-filter: none;",
    "--color-toggle-thumb: #ffffff;",
    "--scene-veil: color-mix(in srgb, var(--color-background) 92%, transparent);",
    "--card-texture: linear-gradient(#f6f4fc, var(--color-card) 140px);",
    "--card-depth: 0 1px 2px rgb(50 50 90 / 6%), 0 22px 44px -26px rgb(50 50 110 / 34%);",
    "--card-material-edge: 0 0 0 1px color-mix(in srgb, #c3bddf 34%, var(--color-border));",
    "--auth-footer-surface: #f3f1fa;",
    "--auth-stage-texture: radial-gradient(ellipse at 12% 20%, #e7e1f6 0, transparent 45%), radial-gradient(ellipse at 90% 88%, #dcebe2 0, transparent 45%), linear-gradient(145deg, #f6f5fb, #eeedf6);",
    "--shadow-auth-button: 0 10px 24px -8px rgb(90 95 176 / 30%);",
  ],
  dark: [
    ...SHARED_DECLARATIONS,
    ...navigationDeclarations({
      surface: "#15261f",
      foreground: "#e4efe7",
      mutedForeground: "#b0c6b9",
      icon: "#9db6a8",
      edge: "#2a4438",
      hover: "#1e3329",
      field: "#182b23",
      fieldBorder: "#4a6a5c",
      fieldBorderHover: "#5f8172",
      activeSurface: "#2c4a3e",
      activeHover: "#335446",
      activeForeground: "#f7f5ff",
      activeIcon: "#f2b894",
    }),
    `--app-scene-filter: ${NIGHT_FILTER};`,
    "--app-scene-wash-color: 18 20 42;",
    "--app-scene-tint: rgb(20 22 80 / 30%);",
    `--sidebar-scene-filter: ${NIGHT_FILTER};`,
    "--color-toggle-thumb: #c9cbe4;",
    "--scene-veil: color-mix(in srgb, var(--color-background) 88%, transparent);",
    "--card-texture: linear-gradient(#222646, var(--color-card) 140px);",
    "--card-depth: 0 1px 0 rgb(255 255 255 / 4%) inset, 0 22px 44px -24px rgb(0 0 20 / 80%);",
    "--card-material-edge: 0 0 0 1px color-mix(in srgb, #5b5f93 34%, var(--color-border));",
    "--auth-footer-surface: #101226;",
    "--auth-stage-texture: radial-gradient(ellipse at 12% 20%, #262350 0, transparent 45%), radial-gradient(ellipse at 90% 88%, #13302a 0, transparent 45%), linear-gradient(145deg, #15172f, #0d0f22);",
    "--shadow-auth-button: 0 10px 24px -8px rgb(178 180 240 / 25%);",
  ],
};
