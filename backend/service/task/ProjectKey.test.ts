import { expect, it } from "vitest";

import { generateProjectKey } from "./ProjectKey";

it.each([
  ["", "TASK"],
  ["   ", "TASK"],
  ["Pages", "PAGE"],
  ["ASTROLAB", "ASTRO"],
  [" animus ", "ANI"],
  ["Big Data Project", "BDP"],
  ["alpha-beta_gamma delta epsilon zeta", "ABGDE"],
  ["a !", "A"],
  ["SuperTool", "SUPER"],
  ["Ab", "AB"],
  ["ab!c", "ABC"],
  ["lowercase", "LOWE"],
  ["Xy", "XY"],
  ["Aa Bb", "AB"],
])("derives the key of %j as %j", (name, key) => {
  expect(generateProjectKey(name)).toBe(key);
});

it("uses the first camel case part when it has three characters", () => {
  expect(generateProjectKey("FooBar")).toBe("FOO");
});

it("falls back to the cleaned name when the camel case part is short", () => {
  expect(generateProjectKey("AbCdefg")).toBe("ABCD");
});
