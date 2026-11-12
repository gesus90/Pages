import { expect, it } from "vitest";

import {
  pairDiffRows,
  parseUnifiedDiff,
} from "@/app/components/chat-page/content/diff-lines";

it("classifies and numbers hunks while preserving header-like content", () => {
  const parsed = parseUnifiedDiff(
    "diff --git a/old.txt b/new.txt\r\n--- a/old.txt\tdate\r\n+++ b/new.txt\r\n@@ -3,2 +7,2 @@\r\n--- old\r\n+++ new\r\n same\r\n",
  );
  expect(parsed.fileName).toBe("new.txt");
  expect(parsed.added).toBe(1);
  expect(parsed.removed).toBe(1);
  expect(parsed.lines.slice(3)).toEqual([
    { kind: "hunk", text: "@@ -3,2 +7,2 @@", oldNumber: null, newNumber: null },
    { kind: "removed", text: "-- old", oldNumber: 3, newNumber: null },
    { kind: "added", text: "++ new", oldNumber: null, newNumber: 7 },
    { kind: "context", text: "same", oldNumber: 4, newNumber: 8 },
  ]);
});

it("uses the old path for deletion and handles missing or malformed headers", () => {
  expect(
    parseUnifiedDiff("--- a/gone\n+++ /dev/null\n@@ -2 +4 @@\n-old\n+new")
      .fileName,
  ).toBe("gone");
  const parsed = parseUnifiedDiff("plain\n@@ invalid\n next\n");
  expect(parsed.fileName).toBeNull();
  expect(
    parsed.lines.map((line) => [line.kind, line.oldNumber, line.newNumber]),
  ).toEqual([
    ["context", 1, 1],
    ["hunk", null, null],
    ["context", 2, 2],
  ]);
  expect(parseUnifiedDiff("").lines).toEqual([]);
});

it("pairs changes across metadata, pads unequal runs and separates later removals", () => {
  const parsed = parseUnifiedDiff(
    "@@ -1,3 +1,3 @@\n-a\n-b\n\\ No newline at end of file\n+x\n-c\n+y\n+z\n context",
  );
  const rows = pairDiffRows(parsed.lines);
  expect(
    rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null]),
  ).toEqual([
    ["@@ -1,3 +1,3 @@", "@@ -1,3 +1,3 @@"],
    ["a", "x"],
    ["b", null],
    ["c", "y"],
    [null, "z"],
    ["context", "context"],
  ]);
});
