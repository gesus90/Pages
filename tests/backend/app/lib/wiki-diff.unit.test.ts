import { describe, expect, it } from "vitest";

import { diffLines } from "@/app/lib/wiki-diff";

describe("diffing wiki text line by line", () => {
  it("marks identical text as unchanged", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("marks an added and a removed line", () => {
    expect(diffLines("a\nc", "a\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
      { kind: "same", text: "c" },
    ]);
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("shows a changed line as removed followed by added", () => {
    expect(diffLines("old", "new")).toEqual([
      { kind: "removed", text: "old" },
      { kind: "added", text: "new" },
    ]);
  });

  it("keeps the longest common run of lines", () => {
    const lines = diffLines("a\nb\nc\nd", "b\nx\nd");

    expect(
      lines.filter((line) => line.kind === "same").map((line) => line.text),
    ).toEqual(["b", "d"]);
    expect(
      lines.filter((line) => line.kind === "removed").map((line) => line.text),
    ).toEqual(["a", "c"]);
    expect(
      lines.filter((line) => line.kind === "added").map((line) => line.text),
    ).toEqual(["x"]);
  });

  it("treats empty text as one empty line", () => {
    expect(diffLines("", "")).toEqual([{ kind: "same", text: "" }]);
    expect(diffLines("", "a")).toEqual([
      { kind: "removed", text: "" },
      { kind: "added", text: "a" },
    ]);
  });

  it("adds trailing lines after the old text ended", () => {
    expect(diffLines("a", "a\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
      { kind: "added", text: "c" },
    ]);
  });

  it("rebuilds the new text from the unchanged and added lines", () => {
    const before = "one\ntwo\nthree\nfour";
    const after = "zero\none\nthree\nfour\nfive";

    const lines = diffLines(before, after);

    expect(
      lines.filter((line) => line.kind !== "removed").map((line) => line.text),
    ).toEqual(after.split("\n"));
    expect(
      lines.filter((line) => line.kind !== "added").map((line) => line.text),
    ).toEqual(before.split("\n"));
  });
});
