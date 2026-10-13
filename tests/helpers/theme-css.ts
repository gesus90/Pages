import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

/** Absolute path of the global stylesheet that defines both palettes. */
export const STYLESHEET_PATH = fileURLToPath(
  new URL("../../app/styles/tailwind.css", import.meta.url),
);

/** The color tokens of one palette, by name without the `--color-` prefix. */
export type PaletteTokens = Readonly<Record<string, string>>;

/** The color tokens of the light and the dark palette of the stylesheet. */
export interface ThemePalettes {
  readonly light: PaletteTokens;
  readonly dark: PaletteTokens;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, "");
}

/** Returns the text between the braces that open at `openingIndex`. */
function readBlock(css: string, openingIndex: number): string {
  let depth = 0;

  for (let index = openingIndex; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return css.slice(openingIndex + 1, index);
      }
    }
  }

  throw new Error("The stylesheet has an unbalanced block.");
}

function readBlockAfter(css: string, marker: string): string {
  const markerIndex = css.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`The stylesheet has no "${marker}".`);
  }

  return readBlock(css, css.indexOf("{", markerIndex));
}

function readColorTokens(block: string): PaletteTokens {
  const tokens: Record<string, string> = {};

  for (const match of block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/gu)) {
    const [, name, value] = match;

    if (name !== undefined && value !== undefined) {
      tokens[name] = value.trim().replace(/\s+/gu, " ");
    }
  }

  return tokens;
}

/**
 * Reads the light palette (`@theme`) and the dark palette (the `dark` variant
 * of `:root`) of the stylesheet.
 *
 * @returns The color token values of both palettes.
 */
export function readThemePalettes(): ThemePalettes {
  const css = stripComments(readFileSync(STYLESHEET_PATH, "utf8"));
  const darkBlock = readBlockAfter(
    readBlockAfter(css, "\n:root {"),
    "@variant dark",
  );

  return {
    dark: readColorTokens(darkBlock),
    light: readColorTokens(readBlockAfter(css, "@theme static")),
  };
}

/** The stylesheet without comments. */
export function readStylesheet(): string {
  return stripComments(readFileSync(STYLESHEET_PATH, "utf8"));
}

type Rgb = readonly [number, number, number];

function oklchToRgb(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((value) => Math.min(1, Math.max(0, value)));
  const [red = 0, green = 0, blue = 0] = linear.map((value) =>
    Math.round(
      (value <= 0.0031308
        ? 12.92 * value
        : 1.055 * value ** (1 / 2.4) - 0.055) * 255,
    ),
  );

  return [red, green, blue];
}

/**
 * Converts a hex or `oklch()` color of the stylesheet to sRGB.
 *
 * @param value - A color as written in the stylesheet.
 * @returns The red, green and blue channels (0 to 255).
 */
export function parseColor(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/iu.exec(value);

  if (hex?.[1] !== undefined) {
    const digits = hex[1];
    const channel = (offset: number): number =>
      Number.parseInt(digits.slice(offset, offset + 2), 16);

    return [channel(0), channel(2), channel(4)];
  }

  const oklch = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/u.exec(value);

  if (oklch?.[1] !== undefined) {
    return oklchToRgb(
      Number(oklch[1]) / 100,
      Number(oklch[2]),
      Number(oklch[3]),
    );
  }

  throw new Error(`Unsupported color "${value}".`);
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const [r = 0, g = 0, b = 0] = [red, green, blue].map((channel) => {
    const ratio = channel / 255;

    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Computes the WCAG 2.1 contrast ratio of two colors.
 *
 * @param foreground - Text or graphic color.
 * @param background - Color it is drawn on.
 * @returns A ratio from 1 to 21.
 */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(parseColor(foreground));
  const second = relativeLuminance(parseColor(background));
  const [lighter, darker] = first >= second ? [first, second] : [second, first];

  return (lighter + 0.05) / (darker + 0.05);
}
