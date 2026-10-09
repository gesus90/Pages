import { describe, expect, it, vi } from "vitest";

import { parseEditorMarkdown } from "@/app/lib/editor/markdown-to-document";

import type { Root } from "mdast";

const tree = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/app/lib/editor/markdown-processor", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/app/lib/editor/markdown-processor")
  >()),
  parseMarkdownTree: () => tree.current,
}));

function parse(root: Root): ReturnType<typeof parseEditorMarkdown> {
  tree.current = root;

  return parseEditorMarkdown("source");
}

describe("reading syntax trees without the usual details", () => {
  it("fills in what a tree from another parser may leave out", () => {
    const { blocks } = parse({
      children: [
        {
          children: [
            { type: "text", value: "" },
            { type: "image", url: "/i" },
          ],
          type: "paragraph",
        },
        {
          children: [
            {
              children: [
                { children: [{ type: "text", value: "a" }], type: "paragraph" },
              ],
              type: "listItem",
            },
          ],
          ordered: true,
          type: "list",
        },
        {
          children: [
            {
              checked: false,
              children: [
                { children: [{ type: "text", value: "t" }], type: "paragraph" },
              ],
              type: "listItem",
            },
          ],
          ordered: false,
          type: "list",
        },
        {
          children: [
            {
              children: [{ children: [], type: "tableCell" }],
              type: "tableRow",
            },
          ],
          type: "table",
        },
      ],
      type: "root",
    });

    expect(blocks.map((block) => [block.start, block.end])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(blocks[0]?.node.content).toEqual([
      { attrs: { alt: "", src: "/i", title: null }, type: "image" },
    ]);
    expect(blocks[1]?.node.attrs).toEqual({ spread: false, start: 1 });
    expect(blocks[2]?.node.attrs).toEqual({ spread: false });
    expect(blocks[3]?.node.content?.[0]?.content?.[0]?.attrs).toEqual({
      align: null,
    });
  });

  it("does not hide errors other than unsupported markdown", () => {
    expect(() =>
      parse({
        children: [
          { depth: 1, type: "heading" } as unknown as Root["children"][number],
        ],
        type: "root",
      }),
    ).toThrow(TypeError);
  });
});
