/** Semantic colors of one palette; the names follow the Pages theme tokens. */
export interface ThemeColors {
  readonly background: string;
  readonly surface: string;
  readonly muted: string;
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly border: string;
  /** Boundary of an input or a choice; it must be seen, so it is stronger than `border`. */
  readonly outline: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly primarySubtle: string;
  readonly destructive: string;
  readonly destructiveSubtle: string;
  readonly success: string;
  readonly successSubtle: string;
  readonly warning: string;
  readonly warningSubtle: string;
  readonly info: string;
  readonly infoSubtle: string;
}

/** Color scheme the app renders in. */
export type ColorScheme = "light" | "dark";

/**
 * Light palette; the values are the light tokens of `app/styles/tailwind.css` in
 * Pages, except three that fail the contrast of the touch UI there: `muted
 * foreground` (4.3:1 on the background, here 5.3:1), `primaryForeground` (white
 * on the orange is 2.8:1, here 6.7:1) and `outline`, which Pages does not have.
 */
export const LIGHT_COLORS: ThemeColors = {
  background: "#f2f4f7",
  surface: "#ffffff",
  muted: "#eef0f4",
  foreground: "#171717",
  mutedForeground: "#5d6574",
  border: "#e9ebf0",
  outline: "#7b8494",
  primary: "#f97316",
  primaryForeground: "#1a0f05",
  primarySubtle: "#fdf4ee",
  destructive: "#c5322b",
  destructiveSubtle: "#fef2f2",
  success: "#047857",
  successSubtle: "#ecfdf5",
  warning: "#b45309",
  warningSubtle: "#fffbeb",
  info: "#1d4ed8",
  infoSubtle: "#eff6ff",
};

/** Dark palette; the values are the dark tokens of `app/styles/tailwind.css` in Pages. */
export const DARK_COLORS: ThemeColors = {
  background: "#0f1217",
  surface: "#171b22",
  muted: "#232831",
  foreground: "#e9ebef",
  mutedForeground: "#9aa3b2",
  border: "#2a303a",
  outline: "#6b7586",
  primary: "#f97316",
  primaryForeground: "#1a0f05",
  primarySubtle: "#2a1b11",
  destructive: "#f87171",
  destructiveSubtle: "#2d1618",
  success: "#34d399",
  successSubtle: "#0f2a20",
  warning: "#fbbf24",
  warningSubtle: "#2b220c",
  info: "#60a5fa",
  infoSubtle: "#12233d",
};

/** Spacing scale in density-independent pixels. */
export const SPACING = {
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 24,
  huge: 32,
} as const;

/** Corner radii in density-independent pixels. */
export const RADIUS = {
  small: 8,
  medium: 12,
  large: 16,
  pill: 999,
} as const;

/** Font sizes and line heights; the system font keeps the app native. */
export const TYPOGRAPHY = {
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700" },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
} as const;

/** Smallest touch target of both platform guidelines. */
export const MINIMUM_TOUCH_TARGET = 48;

/** Widest content column; keeps lines readable on tablets and in landscape. */
export const CONTENT_MAX_WIDTH = 640;

/** The palette for a color scheme. */
export const PALETTES: Readonly<Record<ColorScheme, ThemeColors>> = {
  light: LIGHT_COLORS,
  dark: DARK_COLORS,
};
