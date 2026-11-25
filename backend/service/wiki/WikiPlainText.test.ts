import { expect, it } from "vitest";

import { collapseWhitespace, toPlainText } from "./WikiPlainText";

it("collapses whitespace runs and trims the ends", () => {
  expect(collapseWhitespace("  a \n\t b  ")).toBe("a b");
});

it("reduces markdown to the text a reader sees", () => {
  const markdown = [
    "<!-- block:abc1 -->",
    "# Heading",
    "- [x] **bold** and _italic_ `code`",
    "> quote with [link](https://example.test) and ![image](a.png)",
    "```ts",
    "const kept = 1;",
    "```",
    "| a | b |",
    "| --- | :---: |",
    "[!NOTE] hint",
  ].join("\n");

  expect(toPlainText(markdown)).toBe(
    "Heading bold and italic code quote with link and image const kept = 1; a b hint",
  );
});
