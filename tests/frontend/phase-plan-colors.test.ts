import { describe, expect, it } from "vitest";

import {
  ARCHIVED_LINK_COLOR,
  COLOR_PRESETS,
  TYPE_COLORS,
  hexToHsl,
  hslToHex,
  linkMidColor,
} from "@/app/lib/phase-plan/plan-colors";

describe("hexToHsl", () => {
  it.each([
    ["#ff0000", { h: 0, l: 0.5, s: 1 }],
    ["#00ff00", { h: 120, l: 0.5, s: 1 }],
    ["#0000ff", { h: 240, l: 0.5, s: 1 }],
    ["#ff00ff", { h: 300, l: 0.5, s: 1 }],
    ["#808080", { h: 0, l: 128 / 255, s: 0 }],
    ["#FFFFFF", { h: 0, l: 1, s: 0 }],
  ])("converts %s", (hex, expected) => {
    const result = hexToHsl(hex);

    expect(result?.h).toBeCloseTo(expected.h, 5);
    expect(result?.s).toBeCloseTo(expected.s, 5);
    expect(result?.l).toBeCloseTo(expected.l, 5);
  });

  it("uses the light-side saturation formula for light colors", () => {
    const result = hexToHsl("#ffcccc");

    expect(result?.l).toBeGreaterThan(0.5);
    expect(result?.s).toBeCloseTo(1, 5);
  });

  it("wraps a red hue with more blue than green", () => {
    expect(hexToHsl("#ff0080")?.h).toBeCloseTo(330, 0);
  });

  it.each(["", "ff0000", "#f00", "#gg0000", "#ff00000"])(
    "rejects %j",
    (value) => {
      expect(hexToHsl(value)).toBeNull();
    },
  );
});

describe("hslToHex", () => {
  it.each([
    [0, 1, 0.5, "#ff0000"],
    [60, 1, 0.5, "#ffff00"],
    [120, 1, 0.5, "#00ff00"],
    [180, 1, 0.5, "#00ffff"],
    [240, 1, 0.5, "#0000ff"],
    [300, 1, 0.5, "#ff00ff"],
    [360, 1, 0.5, "#ff0000"],
    [-60, 1, 0.5, "#ff00ff"],
    [0, 0, 0.5, "#808080"],
  ])("formats hue %d with saturation %d and lightness %d", (h, s, l, hex) => {
    expect(hslToHex(h, s, l)).toBe(hex);
  });

  it("round-trips the palette colors", () => {
    for (const preset of COLOR_PRESETS) {
      const hsl = hexToHsl(preset.hex);

      expect(hsl).not.toBeNull();
      expect(hslToHex(hsl?.h ?? 0, hsl?.s ?? 0, hsl?.l ?? 0)).toBe(preset.hex);
    }
  });
});

describe("linkMidColor", () => {
  it("returns the source color when one color is invalid", () => {
    expect(linkMidColor("#ff0000", "nope")).toBe("#ff0000");
    expect(linkMidColor("nope", "#ff0000")).toBe("nope");
  });

  it("goes through the hue circle the short way", () => {
    expect(linkMidColor("#ff0000", "#00ff00")).toBe("#ffff00");
    expect(linkMidColor("#ff0000", "#0000ff")).toBe("#ff00ff");
    expect(linkMidColor("#0000ff", "#ff0000")).toBe("#ff00ff");
  });

  it("keeps the more saturated and the average lightness", () => {
    expect(linkMidColor("#808080", "#808080")).toBe("#808080");
  });
});

describe("palette constants", () => {
  it("offers sixteen distinct presets", () => {
    expect(new Set(COLOR_PRESETS.map((preset) => preset.hex)).size).toBe(16);
  });

  it("defines a color for every milestone color", () => {
    expect(Object.keys(TYPE_COLORS)).toHaveLength(5);
    expect(ARCHIVED_LINK_COLOR).toBe("#94a3b8");
  });
});
