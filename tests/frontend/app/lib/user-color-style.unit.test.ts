import { expect, it } from "vitest";

import {
  createUserColorStyle,
  createUserTextColorStyle,
} from "@/app/lib/user-color-style";

it("hands a user color to the text class as a custom property", () => {
  expect(createUserTextColorStyle("#336699")).toEqual({
    "--chip-color": "#336699",
  });
});

it("tints a chip with the color and an opacity", () => {
  expect(createUserColorStyle("#336699", "33")).toEqual({
    "--chip-color": "#336699",
    backgroundColor: "#33669933",
  });
});

it("adds a light-theme text color for colors too light to read", () => {
  expect(createUserColorStyle("#ffee00", "40", "#665500")).toEqual({
    "--chip-color": "#ffee00",
    "--chip-text": "#665500",
    backgroundColor: "#ffee0040",
  });
});
