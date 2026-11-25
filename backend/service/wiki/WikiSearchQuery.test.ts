import { expect, it } from "vitest";

import { createSnippet, parseSearchText } from "./WikiSearchQuery";

it("splits words and quoted phrases", () => {
  expect(parseSearchText('alpha "big bar" be"ta " " "" "x" "')).toEqual({
    phrases: ["big bar", "x"],
    terms: ["alpha", "beta"],
  });
});

it("drops a lone quote character", () => {
  expect(parseSearchText('a " b')).toEqual({ phrases: [], terms: ["a", "b"] });
});

it("returns the start of a text without a hit", () => {
  expect(createSnippet("one   two\nthree", ["zzz"])).toBe("one two three");
  expect(createSnippet("one two", [])).toBe("one two");
});

it("cuts a passage around the earliest hit", () => {
  const text = `${"a ".repeat(100)}NEEDLE${" b".repeat(100)}`;
  const snippet = createSnippet(text, ["missing", "needle"]);

  expect(snippet.startsWith("…")).toBe(true);
  expect(snippet.endsWith("…")).toBe(true);
  expect(snippet).toContain("NEEDLE");
});
