import { describe, expect, it } from "vitest";

import { EDITOR_MARK, EDITOR_NODE } from "@/app/lib/editor/editor-schema";
import {
  createRawBlock,
  parseEditorMarkdown,
} from "@/app/lib/editor/markdown-to-document";

import type { EditorJsonNode } from "@/app/lib/editor/markdown-to-document";

function nodes(source: string): readonly EditorJsonNode[] {
  return parseEditorMarkdown(source).blocks.map((block) => block.node);
}

function only(source: string): EditorJsonNode {
  const [block, ...others] = nodes(source);
  if (!block || others.length > 0)
    throw new Error(`Expected exactly one block for ${JSON.stringify(source)}`);
  return block;
}

describe("parseEditorMarkdown: text blocks", () => {
  it("reads a heading with its level and a paragraph with marked text", () => {
    expect(
      nodes("## Title\n\nPlain **bold** _italic_ ~~gone~~ `code`"),
    ).toEqual([
      {
        type: EDITOR_NODE.heading,
        attrs: { level: 2 },
        content: [{ type: EDITOR_NODE.text, text: "Title" }],
      },
      {
        type: EDITOR_NODE.paragraph,
        content: [
          { type: EDITOR_NODE.text, text: "Plain " },
          {
            type: EDITOR_NODE.text,
            text: "bold",
            marks: [{ type: EDITOR_MARK.bold }],
          },
          { type: EDITOR_NODE.text, text: " " },
          {
            type: EDITOR_NODE.text,
            text: "italic",
            marks: [{ type: EDITOR_MARK.italic }],
          },
          { type: EDITOR_NODE.text, text: " " },
          {
            type: EDITOR_NODE.text,
            text: "gone",
            marks: [{ type: EDITOR_MARK.strike }],
          },
          { type: EDITOR_NODE.text, text: " " },
          {
            type: EDITOR_NODE.text,
            text: "code",
            marks: [{ type: EDITOR_MARK.code }],
          },
        ],
      },
    ]);
  });
});

describe("parseEditorMarkdown: inline content", () => {
  it("stacks nested emphasis without repeating a mark", () => {
    const block = only("***both***");
    const [text] = block.content ?? [];
    expect(text?.marks?.map((mark) => mark.type).sort()).toEqual(
      [EDITOR_MARK.bold, EDITOR_MARK.italic].sort(),
    );
  });

  it("keeps links with their title, images with their alt text and hard breaks", () => {
    const block = only('[site](https://example.test "Home")\\\n![logo](a.png)');
    expect(block.content).toEqual([
      {
        type: EDITOR_NODE.text,
        text: "site",
        marks: [
          {
            type: EDITOR_MARK.link,
            attrs: { href: "https://example.test", title: "Home" },
          },
        ],
      },
      { type: EDITOR_NODE.hardBreak },
      {
        type: EDITOR_NODE.image,
        attrs: { alt: "logo", src: "a.png", title: null },
      },
    ]);
  });

  it("gives a linked image its link mark and a link without title a null title", () => {
    const block = only("[![alt](b.png)](https://example.test)");
    expect(block.content).toEqual([
      {
        type: EDITOR_NODE.image,
        attrs: { alt: "alt", src: "b.png", title: null },
        marks: [
          {
            type: EDITOR_MARK.link,
            attrs: { href: "https://example.test", title: null },
          },
        ],
      },
    ]);
  });
});

describe("parseEditorMarkdown: inline edge cases", () => {
  it("applies a repeated mark once", () => {
    const block = only("**outer __inner__ end**");
    const marks = (block.content ?? []).map((node) =>
      (node.marks ?? []).map((mark) => mark.type),
    );
    expect(marks).toEqual([
      [EDITOR_MARK.bold],
      [EDITOR_MARK.bold],
      [EDITOR_MARK.bold],
    ]);
  });

  it("gives an image without alt text an empty alt", () => {
    expect(only("![](a.png)").content).toEqual([
      {
        type: EDITOR_NODE.image,
        attrs: { alt: "", src: "a.png", title: null },
      },
    ]);
  });

  it("keeps a paragraph with inline HTML as source", () => {
    const source = "text <b>bold</b> text";
    expect(only(source)).toEqual(createRawBlock(source));
  });
});

describe("parseEditorMarkdown: other blocks", () => {
  it("reads a thematic break, a fenced code block with language and meta, and an empty one", () => {
    expect(nodes("---")).toEqual([{ type: EDITOR_NODE.horizontalRule }]);
    expect(only("```ts title=a\nconst a = 1;\n```")).toEqual({
      type: EDITOR_NODE.codeBlock,
      attrs: { language: "ts", meta: "title=a" },
      content: [{ type: EDITOR_NODE.text, text: "const a = 1;" }],
    });
    expect(only("```\n```")).toEqual({
      type: EDITOR_NODE.codeBlock,
      attrs: { language: null, meta: null },
      content: [],
    });
  });

  it("reads the table of contents marker in any case, but only as the sole text", () => {
    expect(only("[TOC]")).toEqual({ type: EDITOR_NODE.tableOfContents });
    expect(only("[toc] and more").type).toBe(EDITOR_NODE.paragraph);
  });
});

describe("parseEditorMarkdown: quotes, callouts and toggles", () => {
  it("reads a plain quote with its blocks", () => {
    expect(only("> first\n>\n> second")).toMatchObject({
      type: EDITOR_NODE.blockquote,
      content: [
        { type: EDITOR_NODE.paragraph },
        { type: EDITOR_NODE.paragraph },
      ],
    });
  });

  it("keeps a quote that does not start with plain text as a plain quote", () => {
    expect(only("> - item").type).toBe(EDITOR_NODE.blockquote);
    expect(only("> **bold** first").type).toBe(EDITOR_NODE.blockquote);
    expect(only("> ```\n> code\n> ```").type).toBe(EDITOR_NODE.blockquote);
  });

  it("keeps a quote with an unknown marker as a plain quote", () => {
    expect(only("> [!bogus] text").type).toBe(EDITOR_NODE.blockquote);
  });

  it("reads a callout of a known kind with the rest of its first line as body", () => {
    const block = only("> [!NOTE] Mind the gap");
    expect(block).toEqual({
      type: EDITOR_NODE.callout,
      attrs: { kind: "note" },
      content: [
        {
          type: EDITOR_NODE.paragraph,
          content: [{ type: EDITOR_NODE.text, text: "Mind the gap" }],
        },
      ],
    });
  });

  it("gives an empty callout one empty paragraph", () => {
    expect(only("> [!warning]")).toEqual({
      type: EDITOR_NODE.callout,
      attrs: { kind: "warning" },
      content: [{ type: EDITOR_NODE.paragraph }],
    });
  });

  it("reads a toggle with its summary line and its closed body", () => {
    const block = only("> [!toggle] Details\n> more text\n>\n> second block");
    expect(block.type).toBe(EDITOR_NODE.toggle);
    expect(block.attrs).toEqual({ open: false });
    expect(block.content?.[0]).toEqual({
      type: EDITOR_NODE.toggleSummary,
      content: [{ type: EDITOR_NODE.text, text: "Details" }],
    });
    expect(block.content?.slice(1).map((child) => child.type)).toEqual([
      EDITOR_NODE.paragraph,
      EDITOR_NODE.paragraph,
    ]);
  });

  it("reads a toggle without a summary text", () => {
    expect(only("> [!toggle]").content?.[0]).toEqual({
      type: EDITOR_NODE.toggleSummary,
      content: [],
    });
  });
});

describe("parseEditorMarkdown: lists", () => {
  it("reads bullet and ordered lists with their start and spreading", () => {
    expect(only("- one\n- two")).toMatchObject({
      type: EDITOR_NODE.bulletList,
      attrs: { spread: false },
      content: [{ type: EDITOR_NODE.listItem }, { type: EDITOR_NODE.listItem }],
    });
    expect(only("3. three\n\n4. four")).toMatchObject({
      type: EDITOR_NODE.orderedList,
      attrs: { start: 3, spread: true },
    });
  });

  it("reads a task list with its checked states", () => {
    const block = only("- [x] done\n- [ ] open");
    expect(block.type).toBe(EDITOR_NODE.taskList);
    expect(block.content?.map((item) => item.attrs?.checked)).toEqual([
      true,
      false,
    ]);
  });

  it("reads a lone checkbox item as an empty task", () => {
    const block = only("- [ ]\n- [X]");
    expect(block.type).toBe(EDITOR_NODE.taskList);
    expect(block.content).toEqual([
      {
        type: EDITOR_NODE.taskItem,
        attrs: { checked: false },
        content: [{ type: EDITOR_NODE.paragraph }],
      },
      {
        type: EDITOR_NODE.taskItem,
        attrs: { checked: true },
        content: [{ type: EDITOR_NODE.paragraph }],
      },
    ]);
  });

  it("keeps a list that mixes tasks and plain items as source", () => {
    const source = "- [x] done\n- plain";
    expect(only(source)).toEqual(createRawBlock(source));
  });

  it("keeps an ordered task list as source, because only bullet lists hold tasks", () => {
    const source = "1. [x] done";
    expect(only(source)).toEqual(createRawBlock(source));
  });

  it("keeps a list whose item starts with a non-paragraph as source", () => {
    const source = "- ```\n  code\n  ```";
    expect(only(source)).toEqual(createRawBlock(source));
  });

  it("gives an empty item one empty paragraph", () => {
    expect(only("-\n- x").content?.[0]).toEqual({
      type: EDITOR_NODE.listItem,
      content: [{ type: EDITOR_NODE.paragraph }],
    });
  });
});

describe("parseEditorMarkdown: tables", () => {
  it("reads a header row, body rows and the column alignment", () => {
    const block = only("| a | b |\n| :-- | --: |\n| 1 | 2 |");
    expect(block.type).toBe(EDITOR_NODE.table);
    expect(block.content?.map((row) => row.type)).toEqual([
      EDITOR_NODE.tableRow,
      EDITOR_NODE.tableRow,
    ]);
    expect(
      block.content?.map((row) => row.content?.map((cell) => cell.type)),
    ).toEqual([
      [EDITOR_NODE.tableHeader, EDITOR_NODE.tableHeader],
      [EDITOR_NODE.tableCell, EDITOR_NODE.tableCell],
    ]);
    expect(
      block.content?.[0]?.content?.map((cell) => cell.attrs?.align),
    ).toEqual(["left", "right"]);
  });

  it("pads a short row to the widest one", () => {
    const block = only("| a | b |\n| - | - |\n| 1 |");
    expect(block.content?.[1]?.content).toHaveLength(2);
    expect(block.content?.[1]?.content?.[1]).toEqual({
      type: EDITOR_NODE.tableCell,
      attrs: { align: null },
      content: [{ type: EDITOR_NODE.paragraph }],
    });
  });
});

describe("parseEditorMarkdown: source fallback and anchors", () => {
  it.each([
    "<div>raw</div>",
    "[ref]: https://example.test",
    "A note[^1]\n\n[^1]: the note",
  ])("keeps %j as source blocks, character for character", (source) => {
    const { blocks } = parseEditorMarkdown(source);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.node).toEqual(
        createRawBlock(source.slice(block.start, block.end)),
      );
    }
  });

  it("shows an empty source block without content", () => {
    expect(createRawBlock("")).toEqual({ type: EDITOR_NODE.rawMarkdown });
    expect(createRawBlock("x")).toEqual({
      type: EDITOR_NODE.rawMarkdown,
      content: [{ type: EDITOR_NODE.text, text: "x" }],
    });
  });

  it("names the block after an anchor comment and drops the comment", () => {
    const parsed = parseEditorMarkdown("<!-- block:abc123 -->\nText");
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]?.node.attrs).toMatchObject({ blockId: "abc123" });
    expect(parsed.blocks[0]?.start).toBe(0);
    expect(parsed.blocks[0]?.end).toBe(parsed.source.length);
  });

  it("keeps an anchor that names nothing as source, wherever it stands", () => {
    const lonely = parseEditorMarkdown("<!-- block:abc123 -->");
    expect(lonely.blocks).toEqual([
      expect.objectContaining({
        node: createRawBlock("<!-- block:abc123 -->"),
      }),
    ]);
    const twice = parseEditorMarkdown(
      "<!-- block:one -->\n\n<!-- block:two -->\n\nText",
    );
    expect(twice.blocks.map((block) => block.node.type)).toEqual([
      EDITOR_NODE.rawMarkdown,
      EDITOR_NODE.paragraph,
    ]);
    expect(twice.blocks[1]?.node.attrs).toMatchObject({ blockId: "two" });
  });

  it("keeps an anchor as source when the block after it cannot carry one", () => {
    const parsed = parseEditorMarkdown("<!-- block:abc -->\n\n<div>raw</div>");
    expect(parsed.blocks.map((block) => block.node)).toEqual([
      createRawBlock("<!-- block:abc -->"),
      createRawBlock("<div>raw</div>"),
    ]);
  });

  it("reports the offsets of every top-level block", () => {
    const source = "# One\n\nTwo\n\n- three";
    const { blocks } = parseEditorMarkdown(source);
    expect(blocks.map((block) => source.slice(block.start, block.end))).toEqual(
      ["# One", "Two", "- three"],
    );
  });
});
