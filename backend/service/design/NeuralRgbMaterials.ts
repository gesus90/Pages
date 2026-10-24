import { neuralCircuitTexture } from "./NeuralRgbArtwork";

import type { ShippedDesignThemeDeclarations } from "./DesignThemeStylesheet";

const SHARED_MATERIALS = [
  ...["primary", "secondary", "tertiary", "quaternary"].map(
    (role) =>
      `--color-metric-${role}-subtle: color-mix(in srgb, var(--color-metric-${role}) 12%, var(--color-surface));`,
  ),
  "--metric-card-edge-strength: 50%;",
  "--metric-edge-width: 1px;",
  "--field-edge-width: 1px;",
  "--selection-edge-width: 1px;",
  "--color-control-border: var(--color-field-border);",
  "--color-placeholder-foreground: var(--color-muted-foreground);",
  "--color-toggle-thumb: var(--color-muted-foreground);",
  "--color-toggle-thumb-active: var(--color-primary-foreground);",
  "--color-trend-positive: var(--color-success);",
  "--scrollbar-thumb: var(--color-field-border);",
  "--scrollbar-thumb-hover: var(--color-field-border-hover);",
  "--shadow-edge: 90 132 196;",
  "--navigation-selection-edge-width: 1px;",
  "--navigation-focus: var(--color-ring);",
  "--navigation-active-muted-foreground: var(--color-foreground);",
  "--sidebar-texture-size: 280px 680px, auto, auto, auto;",
  "--sidebar-texture-repeat: repeat-y, no-repeat, no-repeat, no-repeat;",
  "--sidebar-edge: inset -1px 0 0 color-mix(in srgb, var(--color-metric-secondary) 23%, transparent), 8px 0 35px -28px var(--color-metric-secondary);",
  "--navigation-selection-texture: linear-gradient(110deg, color-mix(in srgb, var(--color-metric-primary) 19%, var(--color-sidebar)), color-mix(in srgb, var(--color-metric-secondary) 20%, var(--color-sidebar)));",
  "--navigation-selection-shadow: 0 0 22px -12px var(--color-metric-secondary);",
  "--card-material-edge: -1px -1px 0 0 color-mix(in srgb, var(--color-metric-primary) 26%, var(--color-surface)), 1px 1px 0 0 color-mix(in srgb, var(--color-metric-secondary) 20%, var(--color-surface));",
  "--auth-glow-opacity: 0;",
  "--auth-stage-texture-size: cover;",
];

function sidebarTexture(circuit: string): string {
  return `${circuit}, radial-gradient(ellipse at 0% 0%, color-mix(in srgb, var(--color-metric-primary) 10%, transparent), transparent 60%), radial-gradient(ellipse at 90% 95%, color-mix(in srgb, var(--color-metric-secondary) 13%, transparent), transparent 65%), linear-gradient(170deg, var(--color-sidebar), var(--color-background))`;
}

/** Palette-specific decoration; status, workflow, plan and user colors stay independent. */
export const NEURAL_RGB_MATERIALS: ShippedDesignThemeDeclarations = {
  light: [
    ...SHARED_MATERIALS,
    "--shadow-ink: 26 40 70;",
    "--navigation-muted-foreground: #3b4962;",
    "--navigation-primary: #006a80;",
    "--navigation-active-icon: #006a80;",
    "--navigation-focus: #006a80;",
    "--color-metric-primary: #007489;",
    "--color-metric-secondary: #7051b6;",
    "--color-metric-tertiary: #a5439e;",
    "--color-metric-quaternary: #335fc1;",
    "--auth-button-to: #4d64b2;",
    "--user-color-text-max-lightness: 0.48;",
    `--sidebar-texture: ${sidebarTexture(neuralCircuitTexture(["#7a90b8", "#007b91", "#7051b6"]))};`,
    "--auth-stage-texture: radial-gradient(ellipse at 12% 20%, #ebe7f7 0, transparent 43%), radial-gradient(ellipse at 92% 88%, #dfedf4 0, transparent 44%), linear-gradient(145deg, #f9fbff, #f2f4fa);",
    "--shadow-auth-button: 0 10px 24px -8px rgb(0 116 137 / 20%);",
  ],
  dark: [
    ...SHARED_MATERIALS,
    "--shadow-ink: 0 0 0;",
    "--navigation-muted-foreground: #c8d5ec;",
    "--color-metric-primary: #38d5ed;",
    "--color-metric-secondary: #ae95ff;",
    "--color-metric-tertiary: #da70df;",
    "--color-metric-quaternary: #75acff;",
    "--auth-button-to: #9caaff;",
    "--color-plan-progress-label: var(--color-background);",
    "--color-plan-progress-shade: var(--color-foreground);",
    `--sidebar-texture: ${sidebarTexture(neuralCircuitTexture(["#7391ce", "#67d7ea", "#b285ef"]))};`,
    "--auth-stage-texture: radial-gradient(ellipse at 12% 20%, #20203c 0, transparent 43%), radial-gradient(ellipse at 92% 88%, #12303c 0, transparent 44%), linear-gradient(145deg, #101626, #090d16);",
    "--shadow-auth-button: 0 10px 24px -8px rgb(99 220 233 / 25%);",
  ],
};
