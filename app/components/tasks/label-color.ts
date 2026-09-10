import { normalizeHexColorCode } from "@/definition/Task";

export interface HsvColor {
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
}

/** Dark fallback keeping label text readable on very light colors. */
const DARK_LABEL_TEXT = "#44403c";

/**
 * Converts a `#rrggbb` hex code to HSV degrees and ratios.
 *
 * @param hex - Label color accepted by the backend.
 * @returns Hue in `[0, 360)` with saturation and value in `[0, 1]`.
 */
export function hexToHsv(hex: string): HsvColor {
  const normalized = normalizeHexColorCode(hex) ?? "#000000";
  const red = parseInt(normalized.slice(1, 3), 16) / 255;
  const green = parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = parseInt(normalized.slice(5, 7), 16) / 255;

  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;

  let hue = 0;

  if (delta > 0) {
    if (maximum === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (maximum === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }

    hue *= 60;

    if (hue < 0) {
      hue += 360;
    }
  }

  return {
    hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  };
}

function channelToHex(channel: number): string {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * Converts HSV degrees and ratios back to a lowercase `#rrggbb` hex code.
 *
 * @param color - Hue in `[0, 360)` with saturation and value in `[0, 1]`.
 * @returns The matching storable label color.
 */
export function hsvToHex(color: HsvColor): string {
  const saturated = Math.min(1, Math.max(0, color.saturation));
  const valued = Math.min(1, Math.max(0, color.value));
  const chroma = valued * saturated;
  const segment = (((color.hue % 360) + 360) % 360) / 60;
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

  const lift = valued - chroma;

  return `#${channelToHex(red + lift)}${channelToHex(green + lift)}${channelToHex(blue + lift)}`;
}

/**
 * Derives a readable text color for a label pill filled with the color.
 *
 * @remarks
 * The Pages pill renders the label color on a light tint, so very light
 * colors (yellows, limes) would vanish in their own tint. Those fall back to
 * a dark warm gray while saturated colors keep their own hue as text.
 *
 * @param hex - Label color accepted by the backend.
 * @returns Text color keeping the pill legible.
 */
function linearizeChannel(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function getLabelTextColor(hex: string): string {
  const normalized = normalizeHexColorCode(hex) ?? "#000000";
  const red = linearizeChannel(parseInt(normalized.slice(1, 3), 16) / 255);
  const green = linearizeChannel(parseInt(normalized.slice(3, 5), 16) / 255);
  const blue = linearizeChannel(parseInt(normalized.slice(5, 7), 16) / 255);

  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  return luminance > 0.35 ? DARK_LABEL_TEXT : normalized;
}
