import { describe, expect, it } from "vitest";

import {
  extractHeadings,
  plainHeadingText,
  slugifyHeading,
} from "@/app/lib/wiki-headings";
import { WIKI_LIMITS } from "@/definition/Wiki";

describe("heading text", () => {
  it.each([
    { text: "Hello World", slug: "hello-world" },
    { text: "Größe & Maß", slug: "grosse-mass" },
    { text: "Café Ünïcode", slug: "cafe-unicode" },
    { text: "  --Trim--  ", slug: "trim" },
    { text: "***", slug: "" },
  ])("turns “$text” into the anchor “$slug”", ({ text, slug }) => {
    expect(slugifyHeading(text)).toBe(slug);
  });

  it("strips inline markup and keeps link and image text", () => {
    expect(plainHeadingText("**Bold** `code` _em_ ~~old~~")).toBe(
      "Bold code em old",
    );
    expect(
      plainHeadingText(
        "See [the docs](https://example.com) and ![logo](a.png)",
      ),
    ).toBe("See the docs and logo");
  });

  it("cuts the text at the heading limit without splitting a character", () => {
    const text = plainHeadingText("😀".repeat(WIKI_LIMITS.headingLength + 5));

    expect(Array.from(text)).toHaveLength(WIKI_LIMITS.headingLength);
  });
});

describe("extracting headings", () => {
  it("lists headings of level one to three with line numbers and anchors", () => {
    expect(
      extractHeadings(
        "# Title\ntext\n## Part *one*\n### Detail ##\n#### Too deep",
      ),
    ).toEqual([
      { level: 1, text: "Title", id: "title", line: 1 },
      { level: 2, text: "Part one", id: "part-one", line: 3 },
      { level: 3, text: "Detail", id: "detail", line: 4 },
    ]);
  });

  it("numbers repeated headings and names an empty anchor section", () => {
    const headings = extractHeadings("# Intro\n# Intro\n# Intro\n# ***");

    expect(headings.map((heading) => heading.id)).toEqual([
      "intro",
      "intro-1",
      "intro-2",
      "section",
    ]);
  });

  it("ignores headings inside fenced code and resumes after the fence", () => {
    const source = "```\n# not a heading\n```\n# Real\n~~~\n## also not\n~~~";

    expect(extractHeadings(source).map((heading) => heading.text)).toEqual([
      "Real",
    ]);
  });

  it("needs a space after the hashes and some text", () => {
    expect(extractHeadings("#NoSpace\n#\n# \n#  Spaced")).toEqual([
      { level: 1, text: "Spaced", id: "spaced", line: 4 },
    ]);
  });

  it("finds nothing in text without headings", () => {
    expect(extractHeadings("")).toEqual([]);
    expect(extractHeadings("plain\ntext")).toEqual([]);
  });
});
