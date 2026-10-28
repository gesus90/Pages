import { expect, it } from "vitest";

import {
  ALTERNATE_LIST_MARKERS,
  DEFAULT_LIST_MARKERS,
  parseMarkdownTree,
  stringifyMarkdownBlock,
} from "@/app/lib/editor/markdown-processor";

import type { RootContent } from "mdast";

/** The first block of parsed markdown. */
function firstBlock(source: string): RootContent {
  const block = parseMarkdownTree(source).children[0];
  if (block === undefined) throw new Error("No block parsed.");
  return block;
}

it("parses markdown with GFM and source positions", () => {
  const tree = parseMarkdownTree("| a |\n| - |\n| b |\n\n~~gone~~");

  expect(tree.children.map((block) => block.type)).toEqual([
    "table",
    "paragraph",
  ]);
  expect(tree.children[0]?.position?.start.line).toBe(1);
});

it("writes a block with the default markers and escaped text", () => {
  expect(stringifyMarkdownBlock(firstBlock("* one\n* two"))).toBe(
    "- one\n- two",
  );
  expect(stringifyMarkdownBlock(firstBlock("*a* and __b__"))).toBe(
    "_a_ and **b**",
  );
  expect(
    stringifyMarkdownBlock({
      type: "paragraph",
      children: [{ type: "text", value: "1 * 2 [x]" }],
    }),
  ).toBe("1 \\* 2 \\[x]");
});

it("writes the alternate markers for a list after a list of the same kind", () => {
  expect(
    stringifyMarkdownBlock(
      firstBlock("1. one\n2. two"),
      ALTERNATE_LIST_MARKERS,
    ),
  ).toBe("1) one\n2) two");
  expect(
    stringifyMarkdownBlock(firstBlock("- one"), ALTERNATE_LIST_MARKERS),
  ).toBe("* one");
  expect(
    stringifyMarkdownBlock(firstBlock("1) one"), DEFAULT_LIST_MARKERS),
  ).toBe("1. one");
});

it("writes typed text as it is, except brackets in labels and bars in cells", () => {
  const typed = (block: RootContent): string =>
    stringifyMarkdownBlock(block, DEFAULT_LIST_MARKERS, "typed");

  expect(
    typed({
      type: "paragraph",
      children: [{ type: "text", value: "1 * 2 _x_" }],
    }),
  ).toBe("1 * 2 _x_");
  expect(
    typed({
      type: "paragraph",
      children: [
        {
          type: "link",
          url: "https://example.org",
          children: [{ type: "text", value: "see [1]" }],
        },
      ],
    }),
  ).toBe("[see \\[1\\]](https://example.org)");
  expect(typed(firstBlock("| a |\n| - |\n| b |"))).toContain("| a |");
  expect(
    typed({
      type: "table",
      children: [
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "text", value: "x|y" }] },
          ],
        },
      ],
    }),
  ).toContain("x\\|y");
  expect(
    stringifyMarkdownBlock(
      {
        type: "table",
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "x|y" }] },
            ],
          },
        ],
      },
      ALTERNATE_LIST_MARKERS,
      "typed",
    ),
  ).toContain("x\\|y");
});

it("writes literal markers without escaping", () => {
  expect(
    stringifyMarkdownBlock({
      type: "paragraph",
      children: [{ type: "markdownLiteral", value: "> [!NOTE]*" }],
    }),
  ).toBe("> [!NOTE]*");
});
