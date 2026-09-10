import { describe, expect, it } from "vitest";

import {
  getLabelTextColor,
  hexToHsv,
  hsvToHex,
} from "@/app/components/tasks/label-color";

describe("hexToHsv", () => {
  it("returns zero hue and zero saturation for black", () => {
    const result = hexToHsv("#000000");

    expect(result.hue).toBe(0);
    expect(result.saturation).toBe(0);
    expect(result.value).toBe(0);
  });

  it("returns zero hue, zero saturation, and value one for white", () => {
    const result = hexToHsv("#ffffff");

    expect(result.hue).toBe(0);
    expect(result.saturation).toBe(0);
    expect(result.value).toBe(1);
  });

  it("computes the red hue at zero degrees with full value", () => {
    const result = hexToHsv("#ff0000");

    expect(result.hue).toBe(0);
    expect(result.saturation).toBe(1);
    expect(result.value).toBe(1);
  });

  it("computes the green hue at one hundred twenty degrees", () => {
    const result = hexToHsv("#00ff00");

    expect(result.hue).toBeCloseTo(120, 5);
    expect(result.saturation).toBe(1);
    expect(result.value).toBe(1);
  });

  it("computes the blue hue at two hundred forty degrees", () => {
    const result = hexToHsv("#0000ff");

    expect(result.hue).toBeCloseTo(240, 5);
    expect(result.saturation).toBe(1);
    expect(result.value).toBe(1);
  });

  it("normalizes a non-hex string to black before computing", () => {
    const result = hexToHsv("not-a-color");

    expect(result.hue).toBe(0);
    expect(result.saturation).toBe(0);
    expect(result.value).toBe(0);
  });

  it("normalizes a 3-digit shorthand color", () => {
    const result = hexToHsv("#f00");

    expect(result.hue).toBe(0);
    expect(result.saturation).toBe(1);
    expect(result.value).toBe(1);
  });

  it("shifts a negative hue into the positive range", () => {
    const result = hexToHsv("#ff0080");

    expect(result.hue).toBeGreaterThanOrEqual(0);
    expect(result.hue).toBeLessThan(360);
  });

  it("matches a mid-gray with zero saturation", () => {
    const result = hexToHsv("#808080");

    expect(result.saturation).toBe(0);
    expect(result.value).toBeCloseTo(0.502, 2);
  });
});

describe("hsvToHex", () => {
  it("round-trips pure red back to red", () => {
    expect(hsvToHex({ hue: 0, saturation: 1, value: 1 })).toBe("#ff0000");
  });

  it("round-trips pure green back to green", () => {
    expect(hsvToHex({ hue: 120, saturation: 1, value: 1 })).toBe("#00ff00");
  });

  it("round-trips pure blue back to blue", () => {
    expect(hsvToHex({ hue: 240, saturation: 1, value: 1 })).toBe("#0000ff");
  });

  it("returns black when value is zero", () => {
    expect(hsvToHex({ hue: 0, saturation: 0, value: 0 })).toBe("#000000");
  });

  it("returns white when saturation is zero and value is one", () => {
    expect(hsvToHex({ hue: 0, saturation: 0, value: 1 })).toBe("#ffffff");
  });

  it("clamps negative saturation to zero", () => {
    expect(hsvToHex({ hue: 0, saturation: -1, value: 1 })).toBe("#ffffff");
  });

  it("clamps over-saturated input to one", () => {
    expect(hsvToHex({ hue: 0, saturation: 2, value: 1 })).toBe("#ff0000");
  });

  it("normalizes a negative hue into the positive range", () => {
    expect(hsvToHex({ hue: -120, saturation: 1, value: 1 })).toBe("#0000ff");
  });

  it("normalizes a hue above three hundred sixty degrees", () => {
    expect(hsvToHex({ hue: 480, saturation: 1, value: 1 })).toBe("#00ff00");
  });

  it("covers the segment between one hundred eighty and three hundred degrees", () => {
    expect(hsvToHex({ hue: 180, saturation: 1, value: 1 })).toBe("#00ffff");
  });

  it("covers the segment between sixty and one hundred eighty degrees", () => {
    expect(hsvToHex({ hue: 60, saturation: 1, value: 1 })).toBe("#ffff00");
  });

  it("covers the segment between three hundred and three hundred sixty degrees", () => {
    expect(hsvToHex({ hue: 300, saturation: 1, value: 1 })).toBe("#ff00ff");
  });

  it("clamps over-one value to the available channel range", () => {
    expect(hsvToHex({ hue: 0, saturation: 0, value: 2 })).toBe("#ffffff");
  });
});

describe("getLabelTextColor", () => {
  it("returns dark fallback text for very light colors", () => {
    expect(getLabelTextColor("#ffff00")).toBe("#44403c");
  });

  it("returns the color itself for saturated dark colors", () => {
    expect(getLabelTextColor("#ff0000")).toBe("#ff0000");
  });

  it("normalizes a non-hex string before evaluating luminance", () => {
    expect(getLabelTextColor("not-a-color")).toBe("#000000");
  });
});
