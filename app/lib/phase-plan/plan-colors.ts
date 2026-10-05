import { MILESTONE_COLOR } from "@/definition/Task";

import type { MilestoneColor } from "@/definition/Task";

/** Base color of every palette entry a milestone can use. */
export const TYPE_COLORS: Readonly<Record<MilestoneColor, string>> = {
  [MILESTONE_COLOR.STANDARD]: "#f97316",
  [MILESTONE_COLOR.RELEASE]: "#3b82f6",
  [MILESTONE_COLOR.REVIEW]: "#8b5cf6",
  [MILESTONE_COLOR.MARKETING]: "#22c55e",
  [MILESTONE_COLOR.TEAM]: "#64748b",
};

/** One entry of the preset color palette in the symbol picker. */
export interface ColorPreset {
  readonly key: string;
  readonly hex: string;
}

/** Compact two-row preset palette in muted Pages-harmonized tones. */
export const COLOR_PRESETS: readonly ColorPreset[] = [
  { hex: "#f97316", key: "orange" },
  { hex: "#ef4444", key: "red" },
  { hex: "#ec4899", key: "pink" },
  { hex: "#d946ef", key: "magenta" },
  { hex: "#8b5cf6", key: "violet" },
  { hex: "#6366f1", key: "indigo" },
  { hex: "#3b82f6", key: "blue" },
  { hex: "#14b8a6", key: "teal" },
  { hex: "#06b6d4", key: "cyan" },
  { hex: "#22c55e", key: "green" },
  { hex: "#84cc16", key: "lime" },
  { hex: "#eab308", key: "yellow" },
  { hex: "#f59e0b", key: "amber" },
  { hex: "#a16207", key: "brown" },
  { hex: "#6b7280", key: "gray" },
  { hex: "#334155", key: "slate" },
];

/** Color of lines and chips that belong to archived milestones. */
export const ARCHIVED_LINK_COLOR = "#94a3b8";

/**
 * Parses a `#rrggbb` color into HSL components.
 *
 * @param hex - Hex color code with leading `#`.
 * @returns Hue in degrees with saturation and lightness, or `null` when invalid.
 */
export function hexToHsl(hex: string): {
  readonly h: number;
  readonly s: number;
  readonly l: number;
} | null {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);

  if (!match) {
    return null;
  }

  const red = parseInt(match[1], 16) / 255;
  const green = parseInt(match[2], 16) / 255;
  const blue = parseInt(match[3], 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;

  if (maximum === minimum) {
    return { h: 0, l: lightness, s: 0 };
  }

  const delta = maximum - minimum;
  const saturation =
    lightness > 0.5
      ? delta / (2 - maximum - minimum)
      : delta / (maximum + minimum);
  let hue = 0;

  if (maximum === red) {
    hue = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60;
  } else if (maximum === green) {
    hue = ((blue - red) / delta + 2) * 60;
  } else {
    hue = ((red - green) / delta + 4) * 60;
  }

  return { h: hue, l: lightness, s: saturation };
}

/**
 * Formats HSL components as a `#rrggbb` color code.
 *
 * @param hue - Hue in degrees.
 * @param saturation - Saturation between 0 and 1.
 * @param lightness - Lightness between 0 and 1.
 * @returns The lowercase hex color code.
 */
export function hslToHex(
  hue: number,
  saturation: number,
  lightness: number,
): string {
  const wrapped = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = wrapped / 60;
  const mid = chroma * (1 - Math.abs((segment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment < 1) {
    red = chroma;
    green = mid;
  } else if (segment < 2) {
    red = mid;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = mid;
  } else if (segment < 4) {
    green = mid;
    blue = chroma;
  } else if (segment < 5) {
    red = mid;
    blue = chroma;
  } else {
    red = chroma;
    blue = mid;
  }

  const lift = lightness - chroma / 2;
  const toByte = (value: number): string =>
    Math.round((value + lift) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toByte(red)}${toByte(green)}${toByte(blue)}`;
}

/**
 * Mixes two milestone colors through the hue circle.
 *
 * @remarks
 * Plain RGB gradients between complementary colors wash out into gray and
 * vanish on a white background. Interpolating the hue instead keeps the
 * middle of a dependency connection vivid.
 *
 * @param fromHex - Source milestone color.
 * @param toHex - Target milestone color.
 * @returns The vivid midpoint color, or the source color when invalid.
 */
export function linkMidColor(fromHex: string, toHex: string): string {
  const from = hexToHsl(fromHex);
  const to = hexToHsl(toHex);

  if (!from || !to) {
    return fromHex;
  }

  let delta = to.h - from.h;

  if (delta > 180) {
    delta -= 360;
  }

  if (delta < -180) {
    delta += 360;
  }

  const hue = (from.h + delta / 2 + 360) % 360;

  return hslToHex(hue, Math.max(from.s, to.s), (from.l + to.l) / 2);
}
