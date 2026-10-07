import { describe, expect, it } from "vitest";

import {
  isWikiPath,
  toOwnPath,
  transformMarkdownUrl,
} from "@/app/lib/markdown-links";

describe("transformMarkdownUrl", () => {
  it.each([
    "https://example.org/a",
    "http://example.org",
    "mailto:a@example.org",
    "/wiki/page",
    "relative/path",
    "#anchor",
  ])("keeps %s", (url) => {
    expect(transformMarkdownUrl(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html;base64,AAAA",
    "vbscript:x",
    "//evil.example/x",
    "http://",
  ])("neutralises %s", (url) => {
    expect(transformMarkdownUrl(url)).toBe("");
  });
});

describe("isWikiPath", () => {
  it("matches only the Wiki subtree", () => {
    expect(isWikiPath("/wiki")).toBe(true);
    expect(isWikiPath("/wiki/a?x=1")).toBe(true);
    expect(isWikiPath("/wikipedia")).toBe(false);
    expect(isWikiPath("/tasks/1")).toBe(false);
  });
});

describe("toOwnPath", () => {
  it("returns the path of own targets only", () => {
    expect(toOwnPath("/wiki/a")).toBe("/wiki/a");
    expect(toOwnPath("https://pages.test/wiki/a", "https://pages.test")).toBe(
      "/wiki/a",
    );
    expect(
      toOwnPath("https://pages.test.evil.test/a", "https://pages.test"),
    ).toBe(undefined);
    expect(toOwnPath("https://other.test/a", "https://pages.test")).toBe(
      undefined,
    );
  });
});
