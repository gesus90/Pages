import { beforeEach, expect, it, vi } from "vitest";

import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";
import { parseEditorMarkdown } from "@/app/lib/editor/markdown-to-document";

import type { ListItem, Paragraph, Root, RootContent } from "mdast";

// The markdown parser always fills positions, list spreads, list starts, table
// alignments and image texts; these trees leave out what the mdast types allow
// to be missing, so the editor's own defaults are visible.
const parser = vi.hoisted(() => ({ parse: vi.fn<(source: string) => Root>() }));
vi.mock(
  "@/app/lib/editor/markdown-processor",
  async (importOriginal: () => Promise<object>) => ({
    ...(await importOriginal()),
    parseMarkdownTree: parser.parse,
  }),
);

beforeEach(() => {
  parser.parse.mockReset();
});

/** Parses a tree of the given blocks and returns the editor nodes. */
function convert(children: RootContent[]): readonly unknown[] {
  parser.parse.mockReturnValue({ type: "root", children });
  return parseEditorMarkdown("source").blocks.map((block) => block.node);
}

it("drops empty text and gives an image without alternative text an empty one", () => {
  expect(
    convert([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "" },
          { type: "image", url: "/a.png", alt: null, title: null },
        ],
      },
    ]),
  ).toEqual([
    {
      type: EDITOR_NODE.paragraph,
      content: [
        {
          type: EDITOR_NODE.image,
          attrs: { alt: "", src: "/a.png", title: null },
        },
      ],
    },
  ]);
});

it("treats lists without a spread as tight and an ordered list without a start as starting at one", () => {
  const item = (checked?: boolean): ListItem => ({
    type: "listItem",
    checked,
    children: [{ type: "paragraph", children: [{ type: "text", value: "x" }] }],
  });
  const [tasks, bullets, numbers] = convert([
    { type: "list", ordered: false, children: [item(true)] },
    { type: "list", ordered: false, spread: null, children: [item()] },
    { type: "list", ordered: true, start: null, children: [item()] },
  ]);

  expect(tasks).toMatchObject({
    type: EDITOR_NODE.taskList,
    attrs: { spread: false },
  });
  expect(bullets).toMatchObject({
    type: EDITOR_NODE.bulletList,
    attrs: { spread: false },
  });
  expect(numbers).toMatchObject({
    type: EDITOR_NODE.orderedList,
    attrs: { spread: false, start: 1 },
  });
});

it("reads a table without alignments as unaligned", () => {
  const [table] = convert([
    {
      type: "table",
      align: null,
      children: [
        {
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "text", value: "a" }] },
          ],
        },
      ],
    },
  ]);

  expect(table).toEqual({
    type: EDITOR_NODE.table,
    content: [
      {
        type: EDITOR_NODE.tableRow,
        content: [
          {
            type: EDITOR_NODE.tableHeader,
            attrs: { align: null },
            content: [
              {
                type: EDITOR_NODE.paragraph,
                content: [{ type: EDITOR_NODE.text, text: "a" }],
              },
            ],
          },
        ],
      },
    ],
  });
});

it("keeps an unsupported block without a position as an empty source block", () => {
  parser.parse.mockReturnValue({
    type: "root",
    children: [{ type: "html", value: "<div>" }],
  });

  expect(parseEditorMarkdown("<div>").blocks).toEqual([
    { start: 0, end: 0, node: { type: EDITOR_NODE.rawMarkdown } },
  ]);
});

it("does not hide an unexpected failure as a source block", () => {
  const broken: Paragraph = {
    type: "paragraph",
    get children(): Paragraph["children"] {
      throw new Error("broken tree");
    },
  };
  parser.parse.mockReturnValue({ type: "root", children: [broken] });

  expect(() => parseEditorMarkdown("text")).toThrow("broken tree");
});
