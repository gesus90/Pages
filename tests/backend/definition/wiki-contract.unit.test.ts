import { describe, expect, it } from "vitest";

import {
  compareAudience,
  compareInheritedAnchors,
  countCharacters,
  formatWikiCover,
  normalizeWikiTitle,
  parseWikiCover,
  WIKI_COVER_PRESETS,
  WIKI_SCOPE,
} from "@/definition/Wiki";

describe("wiki covers", () => {
  it("round-trips every preset and attachment cover", () => {
    for (const preset of WIKI_COVER_PRESETS) {
      const text = `preset:${preset}`;
      expect(formatWikiCover({ kind: "preset", preset })).toBe(text);
      expect(parseWikiCover(text)).toEqual({ kind: "preset", preset });
    }

    expect(parseWikiCover("attachment:abc-123_X")).toEqual({
      kind: "attachment",
      attachmentId: "abc-123_X",
    });
    expect(formatWikiCover({ kind: "attachment", attachmentId: "a-1" })).toBe(
      "attachment:a-1",
    );
  });

  it.each([
    null,
    "",
    "preset:no-such-preset",
    "attachment:",
    "attachment:has space",
    "attachment:../secret",
    "image:abc",
    `attachment:${"a".repeat(65)}`,
  ])("treats %j as no cover", (value) => {
    expect(parseWikiCover(value)).toBeNull();
  });
});

describe("text helpers", () => {
  it("normalizes titles to one trimmed line", () => {
    expect(normalizeWikiTitle("  Release \n\t notes   v2 ")).toBe(
      "Release notes v2",
    );
    expect(normalizeWikiTitle("   ")).toBe("");
  });

  it("counts Unicode characters, not UTF-16 units", () => {
    expect(countCharacters("a😀b")).toBe(3);
    expect(countCharacters("")).toBe(0);
    expect("😀".length).toBe(2);
  });
});

describe("visibility comparison", () => {
  const privatePage = { scope: WIKI_SCOPE.PRIVATE, projectId: null };
  const projectPage = { scope: WIKI_SCOPE.PROJECT, projectId: "p1" };
  const instancePage = { scope: WIKI_SCOPE.INSTANCE, projectId: null };

  it("names only the direction of a scope change", () => {
    expect(compareAudience(privatePage, projectPage)).toBe("wider");
    expect(compareAudience(projectPage, instancePage)).toBe("wider");
    expect(compareAudience(instancePage, privatePage)).toBe("narrower");
    expect(compareAudience(projectPage, projectPage)).toBe("same");
    expect(
      compareAudience(projectPage, { ...projectPage, projectId: "p2" }),
    ).toBe("different");
  });

  it("compares inherited anchors as sets", () => {
    const some = new Set(["a", "b"]);

    expect(compareInheritedAnchors(some, new Set(["b", "a"]))).toBe("same");
    expect(compareInheritedAnchors(some, new Set(["a", "b", "c"]))).toBe(
      "narrower",
    );
    expect(compareInheritedAnchors(some, new Set(["a"]))).toBe("wider");
    expect(compareInheritedAnchors(some, new Set(["a", "c"]))).toBe(
      "different",
    );
    expect(compareInheritedAnchors(new Set(), new Set())).toBe("same");
  });
});
