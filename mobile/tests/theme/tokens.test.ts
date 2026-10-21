import { DARK_COLORS, LIGHT_COLORS, PALETTES } from "@/theme/tokens";

import type { ThemeColors } from "@/theme/tokens";

function luminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;

    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const [lighter = 0, darker = 0] = [
    luminance(foreground),
    luminance(background),
  ].sort((first, second) => second - first);

  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT_PAIRS: readonly [keyof ThemeColors, keyof ThemeColors][] = [
  ["foreground", "background"],
  ["foreground", "surface"],
  ["foreground", "primarySubtle"],
  ["mutedForeground", "background"],
  ["mutedForeground", "surface"],
  ["mutedForeground", "muted"],
  ["primaryForeground", "primary"],
  ["success", "successSubtle"],
  ["warning", "warningSubtle"],
  ["destructive", "destructiveSubtle"],
  ["destructive", "surface"],
  ["info", "infoSubtle"],
];

describe("theme tokens", () => {
  it.each(["light", "dark"] as const)(
    "%s palette: every text pair reaches 4.5:1",
    (scheme) => {
      const colors = PALETTES[scheme];

      for (const [foreground, background] of TEXT_PAIRS) {
        expect({
          pair: `${foreground} on ${background}`,
          isReadable: contrast(colors[foreground], colors[background]) >= 4.5,
        }).toEqual({
          pair: `${foreground} on ${background}`,
          isReadable: true,
        });
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "%s palette: the outline of an input reaches 3:1 on the surface",
    (scheme) => {
      const colors = PALETTES[scheme];

      expect(contrast(colors.outline, colors.surface)).toBeGreaterThanOrEqual(
        3,
      );
      expect(
        contrast(colors.outline, colors.background),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it("both palettes name the same colors and share the Pica orange", () => {
    expect(Object.keys(DARK_COLORS)).toEqual(Object.keys(LIGHT_COLORS));
    expect(LIGHT_COLORS.primary).toBe("#f97316");
    expect(DARK_COLORS.primary).toBe(LIGHT_COLORS.primary);
  });
});
