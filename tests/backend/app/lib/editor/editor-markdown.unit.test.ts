import { Fragment } from "@tiptap/pm/model";
import { expect, it, vi } from "vitest";

import {
  createBaseline,
  parseMarkdownSlice,
  readMarkdown,
  serializeMarkdown,
  serializeMarkdownFragment,
} from "@/app/lib/editor/editor-markdown";

import {
  EDITOR_TEST_SCHEMA,
  editorNode,
  FOREIGN_SCHEMA,
  topBlocks,
} from "./editor-fixture";

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownBaseline } from "@/app/lib/editor/editor-markdown";

/** A document loaded from markdown together with the baseline of the load. */
function load(markdown: string): {
  readonly doc: ProseMirrorNode;
  readonly baseline: MarkdownBaseline;
} {
  const read = readMarkdown(markdown, EDITOR_TEST_SCHEMA);
  const doc = EDITOR_TEST_SCHEMA.nodeFromJSON(read.content);
  return { doc, baseline: createBaseline(read, doc) };
}

/** A document of the given top-level blocks. */
function documentOf(blocks: readonly ProseMirrorNode[]): ProseMirrorNode {
  return EDITOR_TEST_SCHEMA.node("doc", null, [...blocks]);
}

/** A paragraph of plain text. */
function paragraph(value: string): ProseMirrorNode {
  return editorNode({
    type: "paragraph",
    content: [{ type: "text", text: value }],
  });
}

it("reads markdown into editor content with the places of its blocks", () => {
  const read = readMarkdown("# Title\n\nText\n", EDITOR_TEST_SCHEMA);

  expect(read.source).toBe("# Title\n\nText\n");
  expect(read.blocks.map((block) => [block.start, block.end])).toEqual([
    [0, 7],
    [9, 13],
  ]);
  expect(read.content).toMatchObject({
    type: "doc",
    content: [{ type: "heading" }, { type: "paragraph" }],
  });
});

it("gives empty markdown one empty paragraph", () => {
  expect(readMarkdown("", EDITOR_TEST_SCHEMA).content).toEqual({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
});

it("keeps a block that does not fit the schema as source", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  const read = readMarkdown("Text\n\n# Title", FOREIGN_SCHEMA);

  expect(read.blocks.map((block) => block.node)).toEqual([
    {
      type: "paragraph",
      content: [{ type: "text", text: "Text" }],
    },
    { type: "rawMarkdown", content: [{ type: "text", text: "# Title" }] },
  ]);
  expect(warn).toHaveBeenCalledOnce();
});

it("writes an unchanged document back exactly as it was loaded", () => {
  const source = "\n\n# Title\n\n\n* one\n* two\n\nText   \nmore\n\n";
  const { doc, baseline } = load(source);

  expect(serializeMarkdown(doc, baseline)).toBe(source);
});

it("writes a new document with blank lines between blocks and a final line break", () => {
  const doc = documentOf([paragraph("a"), paragraph("1 * 2")]);

  expect(serializeMarkdown(doc, null)).toBe("a\n\n1 \\* 2\n");
  expect(serializeMarkdown(doc, null, "typed")).toBe("a\n\n1 * 2\n");
  expect(serializeMarkdown(doc, null)).toBe("a\n\n1 \\* 2\n");
});

it("writes nothing for a document of empty paragraphs", () => {
  const doc = documentOf([editorNode({ type: "paragraph" })]);

  expect(serializeMarkdown(doc, null)).toBe("");
});

it("drops new empty paragraphs and keeps the spacing of untouched neighbours", () => {
  const { doc, baseline } = load("A\n\n\nB\n");
  const [first, second] = topBlocks(doc);
  if (first === undefined || second === undefined)
    throw new Error("No blocks.");
  const edited = documentOf([
    first,
    second,
    editorNode({ type: "paragraph" }),
    paragraph("C"),
  ]);

  expect(serializeMarkdown(edited, baseline)).toBe("A\n\n\nB\n\nC\n");
});

it("writes reordered and duplicated blocks with plain blank lines", () => {
  const { doc, baseline } = load("A\n\n\nB");
  const [first, second] = topBlocks(doc);
  if (first === undefined || second === undefined)
    throw new Error("No blocks.");

  expect(serializeMarkdown(documentOf([second, first]), baseline)).toBe(
    "B\n\nA",
  );
  expect(serializeMarkdown(documentOf([first, first, second]), baseline)).toBe(
    "A\n\nA\n\nB",
  );
});

it("writes identical loaded blocks back in their places", () => {
  const source = "Same\n\nSame\n";
  const { doc, baseline } = load(source);

  expect(serializeMarkdown(doc, baseline)).toBe(source);
});

it("gives a list right after a list of the same kind other markers", () => {
  const bullets = editorNode({
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
        ],
      },
    ],
  });
  const tasks = editorNode({
    type: "taskList",
    content: [
      {
        type: "taskItem",
        attrs: { checked: true },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "t" }] },
        ],
      },
    ],
  });
  const numbers = editorNode({
    type: "orderedList",
    content: [
      {
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "n" }] },
        ],
      },
    ],
  });

  expect(
    serializeMarkdown(
      documentOf([bullets, tasks, numbers, numbers, paragraph("p")]),
      null,
    ),
  ).toBe("- a\n\n* [x] t\n\n1. n\n\n1) n\n\np\n");
});

it("rewrites a loaded list that would merge with the list moved before it", () => {
  const { doc, baseline } = load("* a\n\n<!-- note -->\n\n* b\n");
  const [first, , third] = topBlocks(doc);
  if (first === undefined || third === undefined) throw new Error("No blocks.");

  expect(serializeMarkdown(documentOf([first, third]), baseline)).toBe(
    "* a\n\n- b\n",
  );
});

it("reads no marker from a list written after its anchor", () => {
  const { doc, baseline } = load(
    "<!-- block:one -->\n- a\n\n<!-- block:two -->\n- b\n",
  );

  expect(serializeMarkdown(doc, baseline)).toBe(
    "<!-- block:one -->\n- a\n\n<!-- block:two -->\n- b\n",
  );
  expect(serializeMarkdown(doc, null)).toBe(
    "<!-- block:one -->\n- a\n\n<!-- block:two -->\n- b\n",
  );
  const ordered = load("<!-- block:one -->\n1. a\n").doc;
  expect(
    serializeMarkdown(
      documentOf([...topBlocks(ordered), ...topBlocks(ordered)]),
      null,
    ),
  ).toBe("<!-- block:one -->\n1. a\n\n<!-- block:one -->\n1. a\n");
});

it("remembers only the blocks the loaded document still has", () => {
  const read = readMarkdown("A\n\nB\n", EDITOR_TEST_SCHEMA);
  const doc = documentOf([paragraph("A")]);
  const baseline = createBaseline(read, doc);

  expect(baseline.blocks).toHaveLength(1);
  expect(baseline.trailing).toBe("\n");
  expect(createBaseline(readMarkdown("", EDITOR_TEST_SCHEMA), doc)).toEqual({
    blocks: [],
    source: "",
    trailing: "\n",
  });
});

it("writes a copied fragment as markdown blocks and inline text", () => {
  expect(
    serializeMarkdownFragment(
      Fragment.fromArray([
        paragraph("a"),
        editorNode({ type: "paragraph" }),
        paragraph("b"),
      ]),
    ),
  ).toBe("a\n\nb");
  expect(
    serializeMarkdownFragment(
      Fragment.fromArray([
        EDITOR_TEST_SCHEMA.text("plain *text*"),
        editorNode({ type: "hardBreak" }),
        EDITOR_TEST_SCHEMA.text("more", [EDITOR_TEST_SCHEMA.mark("bold")]),
      ]),
    ),
  ).toBe("plain *text*\n\nmore");
});

it("pastes a single paragraph open and other markdown as closed blocks", () => {
  const single = parseMarkdownSlice("Some **text**", EDITOR_TEST_SCHEMA);
  const several = parseMarkdownSlice("# A\n\nB", EDITOR_TEST_SCHEMA);
  const heading = parseMarkdownSlice("# A", EDITOR_TEST_SCHEMA);

  expect([single.openStart, single.openEnd, single.content.childCount]).toEqual(
    [1, 1, 1],
  );
  expect([
    several.openStart,
    several.openEnd,
    several.content.childCount,
  ]).toEqual([0, 0, 2]);
  expect([heading.openStart, heading.content.firstChild?.type.name]).toEqual([
    0,
    "heading",
  ]);
});
