import { describe, expect, it } from "vitest";

import {
  extractHeadings,
  plainHeadingText,
  slugifyHeading,
} from "@/app/lib/wiki-headings";

describe("wiki headings", () => {
  it("reads H1 to H3 with unique anchors and line numbers", () => {
    const headings = extractHeadings(
      [
        "# Intro",
        "text",
        "## Intro",
        "### Intro ###",
        "#### Deep",
        "# ***",
      ].join("\n"),
    );

    expect(headings).toEqual([
      { id: "intro", level: 1, line: 1, text: "Intro" },
      { id: "intro-1", level: 2, line: 3, text: "Intro" },
      { id: "intro-2", level: 3, line: 4, text: "Intro" },
      { id: "section", level: 1, line: 6, text: "" },
    ]);
  });

  it("ignores headings inside code fences", () => {
    expect(
      extractHeadings(
        [
          "```",
          "# not a heading",
          "```",
          "~~~",
          "# also not",
          "~~~",
          "# yes",
        ].join("\n"),
      ),
    ).toEqual([{ id: "yes", level: 1, line: 7, text: "yes" }]);
  });

  it("strips markup and shortens long headings", () => {
    expect(plainHeadingText("**Bold** [link](http://x) `code`")).toBe(
      "Bold link code",
    );
    expect(plainHeadingText("x".repeat(300))).toHaveLength(200);
    expect(slugifyHeading("Über Größe")).toBe("uber-grosse");
  });
});
