import { expect, it } from "vitest";

import {
  getLabelTextColor,
  hexToHsv,
  hsvToHex,
} from "@/app/components/tasks/label-color";

it("converts primary colors, gray and invalid input to HSV", () => {
  expect(hexToHsv("#ff0000")).toEqual({ hue: 0, saturation: 1, value: 1 });
  expect(hexToHsv("#00ff00")).toEqual({ hue: 120, saturation: 1, value: 1 });
  expect(hexToHsv("#0000ff")).toEqual({ hue: 240, saturation: 1, value: 1 });
  expect(hexToHsv("#ff00ff")).toEqual({ hue: 300, saturation: 1, value: 1 });
  expect(hexToHsv("#808080")).toEqual({
    hue: 0,
    saturation: 0,
    value: 128 / 255,
  });
  expect(hexToHsv("invalid")).toEqual({ hue: 0, saturation: 0, value: 0 });
});

it("converts each hue sector and clamps saturation and brightness", () => {
  const colors = [
    "#ff0000",
    "#ffff00",
    "#00ff00",
    "#00ffff",
    "#0000ff",
    "#ff00ff",
  ];
  for (const [index, color] of colors.entries()) {
    expect(hsvToHex({ hue: index * 60, saturation: 1, value: 1 })).toBe(color);
    expect(hsvToHex(hexToHsv(color))).toBe(color);
  }
  expect(hsvToHex({ hue: -60, saturation: 2, value: 2 })).toBe("#ff00ff");
  expect(hsvToHex({ hue: 420, saturation: -1, value: 0.5 })).toBe("#808080");
  expect(hsvToHex({ hue: 0, saturation: 1, value: -1 })).toBe("#000000");
});

it("uses dark text for bright labels and preserves normalized darker colors", () => {
  expect(getLabelTextColor("#ffff00")).toBe("#44403c");
  expect(getLabelTextColor("#FFFFFF")).toBe("#44403c");
  expect(getLabelTextColor("#FF0000")).toBe("#ff0000");
  expect(getLabelTextColor("invalid")).toBe("#000000");
});
