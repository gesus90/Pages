import { describe, expect, it } from "vitest";

import {
  ARCHIVED_LINK_COLOR,
  COLOR_PRESETS,
  TYPE_COLORS,
  hexToHsl,
  hslToHex,
  linkMidColor,
} from "@/app/lib/phase-plan/plan-colors";
import { MILESTONE_COLOR } from "@/definition/Task";

describe("milestone colors", () => {
  it("gives every milestone type its own hex color", () => {
    const colors = Object.values(MILESTONE_COLOR).map(
      (type) => TYPE_COLORS[type],
    );

    expect(colors.every((hex) => /^#[0-9a-f]{6}$/u.test(hex))).toBe(true);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("offers sixteen distinct presets, none of them the archived link color", () => {
    expect(COLOR_PRESETS).toHaveLength(16);
    expect(new Set(COLOR_PRESETS.map((preset) => preset.hex)).size).toBe(16);
    expect(new Set(COLOR_PRESETS.map((preset) => preset.key)).size).toBe(16);
    expect(COLOR_PRESETS.map((preset) => preset.hex)).not.toContain(
      ARCHIVED_LINK_COLOR,
    );
  });
});

describe("converting colors", () => {
  it.each([
    { hex: "#ff0000", hue: 0 },
    { hex: "#ffff00", hue: 60 },
    { hex: "#00ff00", hue: 120 },
    { hex: "#00ffff", hue: 180 },
    { hex: "#0000ff", hue: 240 },
    { hex: "#ff00ff", hue: 300 },
  ])("reads the hue of $hex as $hue degrees", ({ hex, hue }) => {
    expect(hexToHsl(hex)).toEqual({ h: hue, s: 1, l: 0.5 });
  });

  it("reads greys without any saturation and keeps their lightness", () => {
    expect(hexToHsl("#000000")).toEqual({ h: 0, s: 0, l: 0 });
    expect(hexToHsl("#ffffff")).toEqual({ h: 0, s: 0, l: 1 });
  });

  it("reads light and dark saturated colors with the matching saturation formula", () => {
    const light = hexToHsl("#ff8080");
    const dark = hexToHsl("#800000");

    expect(light?.l).toBeGreaterThan(0.5);
    expect(light?.s).toBeCloseTo(1, 2);
    expect(dark?.l).toBeLessThan(0.5);
    expect(dark?.s).toBeCloseTo(1, 2);
  });

  it("wraps the hue of red-dominant colors with a larger blue than green", () => {
    expect(hexToHsl("#ff0080")?.h).toBeCloseTo(330, 0);
  });

  it("is case-insensitive and refuses anything but six hex digits with a hash", () => {
    expect(hexToHsl("#FF0000")).toEqual(hexToHsl("#ff0000"));
    expect(hexToHsl("ff0000")).toBeNull();
    expect(hexToHsl("#f00")).toBeNull();
    expect(hexToHsl("#gg0000")).toBeNull();
  });

  it.each([
    { hue: 0, hex: "#ff0000" },
    { hue: 60, hex: "#ffff00" },
    { hue: 120, hex: "#00ff00" },
    { hue: 180, hex: "#00ffff" },
    { hue: 240, hex: "#0000ff" },
    { hue: 300, hex: "#ff00ff" },
  ])("writes hue $hue at full saturation as $hex", ({ hue, hex }) => {
    expect(hslToHex(hue, 1, 0.5)).toBe(hex);
  });

  it("wraps hues below zero and above a full turn", () => {
    expect(hslToHex(-60, 1, 0.5)).toBe(hslToHex(300, 1, 0.5));
    expect(hslToHex(480, 1, 0.5)).toBe(hslToHex(120, 1, 0.5));
  });

  it("writes lightness extremes as black and white", () => {
    expect(hslToHex(200, 0.7, 0)).toBe("#000000");
    expect(hslToHex(200, 0.7, 1)).toBe("#ffffff");
  });

  it("round-trips every preset within one step per channel", () => {
    for (const preset of COLOR_PRESETS) {
      const hsl = hexToHsl(preset.hex);
      if (!hsl) throw new Error(`Unreadable preset ${preset.key}`);
      const back = hslToHex(hsl.h, hsl.s, hsl.l);

      for (const channel of [1, 3, 5])
        expect(
          Math.abs(
            parseInt(back.slice(channel, channel + 2), 16) -
              parseInt(preset.hex.slice(channel, channel + 2), 16),
          ),
        ).toBeLessThanOrEqual(1);
    }
  });
});

describe("the color of a link between two milestones", () => {
  it("blends to the hue halfway on the shorter way around the wheel", () => {
    expect(hexToHsl(linkMidColor("#ff0000", "#00ff00"))?.h).toBeCloseTo(60, 0);
    expect(hexToHsl(linkMidColor("#ff0080", "#ff8000"))?.h).toBeCloseTo(0, 0);
    expect(hexToHsl(linkMidColor("#ff8000", "#ff0080"))?.h).toBeCloseTo(0, 0);
  });

  it("keeps the larger saturation and averages the lightness", () => {
    const mixed = hexToHsl(linkMidColor("#ff0000", "#808080"));

    expect(mixed?.s).toBeCloseTo(1, 1);
    expect(mixed?.l).toBeCloseTo((0.5 + 128 / 255) / 2, 1);
  });

  it("falls back to the start color when either end is not a hex color", () => {
    expect(linkMidColor("red", "#00ff00")).toBe("red");
    expect(linkMidColor("#ff0000", "green")).toBe("#ff0000");
  });
});
