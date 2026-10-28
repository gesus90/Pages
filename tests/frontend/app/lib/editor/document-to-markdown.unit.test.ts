import { expect, it } from "vitest";

import {
  serializeEditorBlock,
  toPhrasing,
} from "@/app/lib/editor/document-to-markdown";
import { ALTERNATE_LIST_MARKERS } from "@/app/lib/editor/markdown-processor";

import {
  editorDocument,
  editorNode,
  FOREIGN_SCHEMA,
  topBlocks,
} from "./editor-fixture";

/** Writes every block of the markdown back after reading it into the editor. */
function roundTrip(markdown: string): string[] {
  return topBlocks(editorDocument(markdown)).map((block) =>
    serializeEditorBlock(block),
  );
}

/** A text node with marks, in the JSON form of the editor. */
function text(
  value: string,
  ...marks: readonly (string | Readonly<Record<string, unknown>>)[]
): Readonly<Record<string, unknown>> {
  return {
    type: "text",
    text: value,
    marks: marks.map((mark) =>
      typeof mark === "string" ? { type: mark } : mark,
    ),
  };
}

/** Writes a paragraph of the given inline nodes. */
function paragraph(
  ...content: readonly Readonly<Record<string, unknown>>[]
): string {
  return serializeEditorBlock(editorNode({ type: "paragraph", content }));
}

const IMAGE = { type: "image", attrs: { src: "/a.png", alt: "A" } };

it("writes headings, rules, code and the table of contents", () => {
  expect(
    roundTrip("## Title\n\n---\n\n```ts meta\nconst a = 1;\n```\n\n[toc]"),
  ).toEqual(["## Title", "---", "```ts meta\nconst a = 1;\n```", "[toc]"]);
  expect(
    serializeEditorBlock(
      editorNode({ type: "codeBlock", content: [text("plain")] }),
    ),
  ).toBe("```\nplain\n```");
});

it("writes a heading of an unknown level as a first-level heading", () => {
  expect(
    serializeEditorBlock(
      editorNode({
        type: "heading",
        attrs: { level: 7 },
        content: [text("x")],
      }),
    ),
  ).toBe("# x");
});

it("writes inline marks, code, breaks, images and links", () => {
  expect(
    roundTrip(
      'Plain **bold** _italic_ ~~gone~~ `code` [link](https://a.example "Title") ![Alt](/a.png "Pic")  \nnext',
    ),
  ).toEqual([
    'Plain **bold** _italic_ ~~gone~~ `code` [link](https://a.example "Title") ![Alt](/a.png "Pic")\\\nnext',
  ]);
});

it("writes images and links without their optional texts", () => {
  expect(paragraph({ type: "image", attrs: {} })).toBe("![]()");
  expect(paragraph(text("site", { type: "link", attrs: {} }))).toBe("[site]()");
});

it("nests the mark that spans the most text outside", () => {
  expect(paragraph(text("a", "bold", "italic"), text(" b", "bold"))).toBe(
    "**_a_ b**",
  );
  expect(paragraph(text("a ", "italic"), text("b", "bold", "italic"))).toBe(
    "_a **b**_",
  );
  expect(paragraph(text("a", "bold"), text(" b"))).toBe("**a** b");
});

it("writes code with emphasis as emphasised inline code", () => {
  expect(paragraph(text("x", "bold", "code"))).toBe("**`x`**");
});

it("moves blanks at the edges of emphasis out of it", () => {
  expect(paragraph(text("x"), text(" a ", "bold"), text("y"))).toBe(
    "x **a** y",
  );
  expect(paragraph(text("x"), text("  ", "strike"), text("y"))).toBe("x  y");
  expect(paragraph(text("x "), text("a", "italic"), text(" y"))).toBe(
    "x _a_ y",
  );
});

it("keeps images at the edges of emphasis inside it", () => {
  expect(
    paragraph(
      text("x "),
      { ...IMAGE, marks: [{ type: "bold" }] },
      text("b ", "bold"),
      text("y"),
    ),
  ).toBe("x **![A](/a.png)b** y");
  expect(
    paragraph(text("x"), text(" a", "bold"), {
      ...IMAGE,
      marks: [{ type: "bold" }],
    }),
  ).toBe("x **a![A](/a.png)**");
});

it("drops blanks at the edges of a paragraph but not around images", () => {
  expect(paragraph(text("  a  "))).toBe("a");
  expect(paragraph(IMAGE, text(" a "), IMAGE)).toBe(
    "![A](/a.png) a ![A](/a.png)",
  );
  expect(paragraph(text(" "), { type: "hardBreak" }, text("b"))).toBe("\\\nb");
});

it("returns the phrasing of a text block", () => {
  expect(
    toPhrasing(editorNode({ type: "paragraph", content: [text("a")] })),
  ).toEqual([{ type: "text", value: "a" }]);
});

it("writes nothing for an empty paragraph, even with an anchor", () => {
  expect(serializeEditorBlock(editorNode({ type: "paragraph" }))).toBe("");
  expect(
    serializeEditorBlock(
      editorNode({ type: "paragraph", attrs: { blockId: "abc" } }),
    ),
  ).toBe("");
});

it("writes the anchor of a block on the line before it", () => {
  expect(
    serializeEditorBlock(
      editorNode({
        type: "paragraph",
        attrs: { blockId: "abc" },
        content: [text("a")],
      }),
    ),
  ).toBe("<!-- block:abc -->\na");
});

it("writes a source block exactly as it is", () => {
  expect(roundTrip("<div>raw *text*</div>")).toEqual(["<div>raw *text*</div>"]);
});

it("writes quotes, nested source and dropped empty paragraphs", () => {
  expect(roundTrip("> quoted\n>\n> more")).toEqual(["> quoted\n>\n> more"]);
  expect(
    serializeEditorBlock(
      editorNode({
        type: "blockquote",
        content: [
          { type: "paragraph" },
          { type: "rawMarkdown", content: [text("<b>")] },
        ],
      }),
    ),
  ).toBe("> \\<b>");
});

it("writes bullet, ordered and task lists with their markers", () => {
  expect(roundTrip("- a\n- b\n\n3. c\n4. d\n\n- [x] done\n- [ ] open")).toEqual(
    ["- a\n- b", "3. c\n4. d", "- [x] done\n- [ ] open"],
  );
  expect(
    serializeEditorBlock(
      topBlocks(editorDocument("1. a"))[0] ?? editorNode({ type: "paragraph" }),
      ALTERNATE_LIST_MARKERS,
    ),
  ).toBe("1) a");
  expect(roundTrip("- a\n\n- b")).toEqual(["- a\n\n- b"]);
});

it("writes empty tasks as a lone checkbox", () => {
  expect(roundTrip("- [ ]\n- [x]")).toEqual(["- [ ]\n- [x]"]);
});

it("writes an ordered list without a start as starting at one", () => {
  expect(
    serializeEditorBlock(
      editorNode({
        type: "orderedList",
        attrs: { start: null },
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [text("a")] }],
          },
        ],
      }),
    ),
  ).toBe("1. a");
});

it("writes callouts with their kind and content", () => {
  expect(roundTrip("> [!WARNING]\n> Careful")).toEqual([
    "> [!WARNING]\n> Careful",
  ]);
  expect(
    serializeEditorBlock(
      editorNode({
        type: "callout",
        attrs: { kind: "" },
        content: [
          { type: "codeBlock", content: [text("x")] },
          { type: "paragraph", content: [text("after")] },
        ],
      }),
    ),
  ).toBe("> [!NOTE]\n>\n> ```\n> x\n> ```\n>\n> after");
  expect(
    serializeEditorBlock(
      editorNode({ type: "callout", content: [{ type: "paragraph" }] }),
    ),
  ).toBe("> [!NOTE]");
});

it("writes toggles with their title and body", () => {
  expect(roundTrip("> [!TOGGLE] Details\n> body")).toEqual([
    "> [!TOGGLE] Details\n>\n> body",
  ]);
  expect(
    serializeEditorBlock(
      editorNode({
        type: "toggle",
        content: [
          { type: "toggleSummary" },
          { type: "paragraph" },
          { type: "paragraph", content: [text("body")] },
        ],
      }),
    ),
  ).toBe("> [!TOGGLE]\n>\n> body");
});

it("writes tables with alignment and spanned cells", () => {
  expect(roundTrip("| a | b |\n| :-: | -: |\n| c | d |")).toEqual([
    "|  a  |  b |\n| :-: | -: |\n|  c  |  d |",
  ]);
  const cell = (
    type: string,
    value: string,
    attrs: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> => ({
    type,
    attrs,
    content: [{ type: "paragraph", content: [text(value)] }],
  });
  expect(
    serializeEditorBlock(
      editorNode({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              cell("tableHeader", "wide", { colspan: 2, align: "left" }),
              cell("tableHeader", "odd", { align: "justify" }),
            ],
          },
          {
            type: "tableRow",
            content: [
              cell("tableCell", "a", {}),
              cell("tableCell", "b", {}),
              cell("tableCell", "c", {}),
            ],
          },
        ],
      }),
    ),
  ).toBe("| wide |    | odd |\n| :--- | :- | --- |\n| a    | b  | c   |");
});

it("writes typed text without escaping", () => {
  const block = editorNode({ type: "paragraph", content: [text("1 * 2")] });

  expect(serializeEditorBlock(block)).toBe("1 \\* 2");
  expect(serializeEditorBlock(block, undefined, "typed")).toBe("1 * 2");
});

it("writes inline nodes and marks of other schemas as plain text", () => {
  const block = FOREIGN_SCHEMA.nodeFromJSON({
    type: "paragraph",
    content: [
      { type: "text", text: "under", marks: [{ type: "underline" }] },
      { type: "text", text: " " },
      { type: "mention" },
      { type: "spacer" },
    ],
  });

  expect(serializeEditorBlock(block)).toBe("under @ada");
});
