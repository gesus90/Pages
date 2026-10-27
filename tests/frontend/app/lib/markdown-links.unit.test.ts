import { describe, expect, it } from "vitest";

import {
  isWikiPath,
  toOwnPath,
  transformMarkdownUrl,
} from "@/app/lib/markdown-links";

describe("transforming a markdown link target", () => {
  it.each([
    "https://example.com/a?b=c#d",
    "http://example.com",
    "mailto:team@example.com",
    "/wiki/abc",
    "/aufgaben/attachments/1",
    "relative/path",
    "#anchor",
    "?query=1",
  ])("keeps %s", (url) => {
    expect(transformMarkdownUrl(url)).toBe(url);
  });

  it("trims the target before it decides", () => {
    expect(transformMarkdownUrl("  https://example.com  ")).toBe(
      "https://example.com",
    );
  });

  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html;base64,AAAA",
    "vbscript:run",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "//evil.example.com/path",
    "http://[::1",
  ])("removes %s", (url) => {
    expect(transformMarkdownUrl(url)).toBe("");
  });

  it("recognizes the wiki paths exactly", () => {
    expect(isWikiPath("/wiki")).toBe(true);
    expect(isWikiPath("/wiki/abc")).toBe(true);
    expect(isWikiPath("/wiki?x=1")).toBe(true);
    expect(isWikiPath("/wiki#top")).toBe(true);
    expect(isWikiPath("/wikipedia")).toBe(false);
    expect(isWikiPath("wiki/abc")).toBe(false);
  });
});

describe("links to the own instance", () => {
  it("keeps a link without a scheme", () => {
    expect(toOwnPath("/wiki/abc")).toBe("/wiki/abc");
    expect(toOwnPath("page?x=1", "https://pages.example.com")).toBe("page?x=1");
  });

  it("turns an absolute link to the own origin into a path", () => {
    expect(
      toOwnPath(
        "https://pages.example.com/wiki/abc",
        "https://pages.example.com",
      ),
    ).toBe("/wiki/abc");
  });

  it("refuses a link to another origin, or any link when the origin is unknown", () => {
    expect(
      toOwnPath("https://other.example.com/wiki", "https://pages.example.com"),
    ).toBeUndefined();
    expect(
      toOwnPath(
        "https://pages.example.com.evil.net/x",
        "https://pages.example.com",
      ),
    ).toBeUndefined();
    expect(
      toOwnPath("https://pages.example.com", "https://pages.example.com"),
    ).toBeUndefined();
    expect(toOwnPath("https://pages.example.com/wiki")).toBeUndefined();
    expect(
      toOwnPath("mailto:a@example.com", "https://pages.example.com"),
    ).toBeUndefined();
  });
});
