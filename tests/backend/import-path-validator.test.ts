import { describe, expect, it } from "vitest";

import {
  duplicateImportPaths,
  isValidImportPath,
} from "@/backend/service/agents/ImportPathValidator";

describe("import source paths", () => {
  it.each([
    "intro.md",
    "guide/README.md",
    "guide/index.md",
    "ümlaut/😀.md",
    "one two/FILE.MD",
  ])("accepts portable relative Markdown path %s", (sourceKey) => {
    expect(isValidImportPath(sourceKey)).toBe(true);
  });

  it.each([
    "",
    "/file.md",
    "//host/file.md",
    "C:/file.md",
    "C:\\file.md",
    "../file.md",
    "guide/../file.md",
    "guide/./file.md",
    "./file.md",
    "guide//file.md",
    "guide/ file.md",
    "guide /file.md",
    "file.md ",
    "file.txt",
    "file.md?x",
    "file.md#x",
    "%2e%2e/file.md",
    "https://host/file.md",
    "a\u0000/file.md",
    "a\u007f/file.md",
    "u\u0308mlaut/file.md",
  ])("rejects unsafe or ambiguous source path %j", (sourceKey) => {
    expect(isValidImportPath(sourceKey)).toBe(false);
  });

  it("reports each duplicate once and retains case-sensitive source identity", () => {
    expect(
      duplicateImportPaths(["b.md", "a.md", "a.md", "b.md", "a.md", "A.md"]),
    ).toEqual([
      { code: "CONFLICT", reason: "duplicate_source", sourceKeys: ["a.md"] },
      { code: "CONFLICT", reason: "duplicate_source", sourceKeys: ["b.md"] },
    ]);
    expect(duplicateImportPaths(["a.md", "A.md"])).toEqual([]);
  });
});
