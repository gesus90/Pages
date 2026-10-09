import { getSchema, Mark, Node } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { describe, expect, it, vi } from "vitest";

import {
  createSchemaExtensions,
  HEADLESS_SCHEMA_OPTIONS,
} from "@/app/components/editor/editor-extensions";
import {
  createBaseline,
  parseMarkdownSlice,
  readMarkdown,
  serializeMarkdown,
  serializeMarkdownFragment,
} from "@/app/lib/editor/editor-markdown";
import {
  readFlagAttribute,
  readNumberAttribute,
  readTextAttribute,
} from "@/app/lib/editor/editor-schema";
import {
  ALTERNATE_LIST_MARKERS,
  stringifyMarkdownBlock,
} from "@/app/lib/editor/markdown-processor";
import {
  createRawBlock,
  parseEditorMarkdown,
} from "@/app/lib/editor/markdown-to-document";

import type { JSONContent } from "@tiptap/core";

const schema = getSchema(createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS));

/** A schema with one unknown block, inline node and mark, as later versions might add. */
const extendedSchema = getSchema([
  ...createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS),
  Node.create({ content: "inline*", group: "block", name: "note" }),
  Node.create({ atom: true, group: "inline", inline: true, name: "chip" }),
  Node.create({ content: "text*", group: "inline", inline: true, name: "tag" }),
  Mark.create({ name: "highlight" }),
]);

const CORPUS: readonly string[] = [
  "## Worum geht es?\n\n\n## Notizen\n\n- \n",
  "[toc]\n\n## Ziel\n\n\n## Voraussetzungen\n\n- \n\n## Schritte\n\n1. \n\n## Probleme und Lösungen\n\n",
  "## Die Idee\n\n\n## Offene Fragen\n\n- [ ] \n",
  '# Title\n\nSetext\n======\n\nText with *em*, __strong__, ~~gone~~, `code` and [link](https://example.com "T").\nSoft break.\n\nHard  \nbreak\\\nend.\n',
  "- a\n- b\n  - nested\n    1. deep\n\n* star\n\n3. three\n4. four\n\n1) paren\n\n- loose\n\n- items\n",
  "- [ ] open\n- [x] done\n  - [ ] nested\n",
  "> quote\n>\n> > nested\n\n> [!NOTE]\n> note\n\n> [!WARNING]\n> warn\n>\n> - list\n\n> [!TIP] inline\n\n> [!TOGGLE] Title\n> Body\n\n> [!TOGGLE] Other\n>\n> Separate\n\n> [!UNKNOWN] plain\n",
  '```ts title="x"\nconst a = 1;\n```\n\n~~~\ntilde\n~~~\n\n    indented\n\n---\n\n***\n',
  "| L | C | R | N |\n| :- | :-: | -: | - |\n| a \\| b | **c** | `d` | [e](/wiki/x) |\n| 1 | 2 | 3 |\n",
  '![img](/wiki/attachments/a1) ![ext](https://example.com/x.png "t") 🎉 äöü 漢字\n',
  "<div>raw</div>\n\nInline <span>html</span>.\n\n[ref][r]\n\n[r]: https://example.com\n\nNote[^1]\n\n[^1]: Foot\n\n- [ ] task\n- plain\n\n1. [ ] ordered\n\n<!-- comment -->\n",
  "<!-- block:abc123 -->\nAnchored.\n\n<!-- block:def456 -->\n<div>x</div>\n\n<!-- block:ghi789 -->\n<!-- block:jkl012 -->\n## Heading\n\n<!-- block:end000 -->",
  "# CRLF\r\n\r\ntext\r\n",
  "\n\n  # Leading\n\nNo trailing newline",
  "",
  "[TOC]\n",
];

function load(source: string, target = schema) {
  const markdown = readMarkdown(source, target);
  const doc = target.nodeFromJSON(markdown.content);

  return { baseline: createBaseline(markdown, doc), doc, markdown };
}

function doc(content: JSONContent[], target = schema) {
  return target.nodeFromJSON({ content, type: "doc" });
}

function text(value: string, marks: JSONContent["marks"] = []): JSONContent {
  return marks.length === 0
    ? { text: value, type: "text" }
    : { marks, text: value, type: "text" };
}

function paragraph(...content: JSONContent[]): JSONContent {
  return content.length === 0
    ? { type: "paragraph" }
    : { content, type: "paragraph" };
}

function write(content: JSONContent[], target = schema): string {
  return serializeMarkdown(doc(content, target), null);
}

describe("markdown round trip", () => {
  it.each(CORPUS.map((source) => [source]))(
    "keeps %j exactly when nothing changed",
    (source) => {
      const { baseline, doc: loaded } = load(source);

      loaded.check();
      expect(serializeMarkdown(loaded, baseline)).toBe(source);
    },
  );

  it.each(CORPUS.map((source) => [source]))(
    "writes %j in a stable normalized form",
    (source) => {
      const first = serializeMarkdown(load(source).doc, null);
      const again = serializeMarkdown(load(first).doc, null);

      expect(again).toBe(first);
    },
  );

  it("starts an empty document with one empty paragraph", () => {
    expect(readMarkdown("", schema).content).toEqual({
      content: [{ type: "paragraph" }],
      type: "doc",
    });
    expect(createRawBlock("")).toEqual({ type: "rawMarkdown" });
  });
});

describe("reading markdown", () => {
  const types = (source: string): string[] =>
    parseEditorMarkdown(source).blocks.map((block) => block.node.type);

  it("reads lone checkboxes as empty tasks and mixed or ordered tasks as source", () => {
    expect(types("- [ ]\n- [x]\n")).toEqual(["taskList"]);
    expect(types("- [x] done\n- [ ] \n")).toEqual(["taskList"]);
    expect(types("- [ ] task\n- plain\n")).toEqual(["rawMarkdown"]);
    expect(types("1. [ ] ordered\n")).toEqual(["rawMarkdown"]);
    expect(types("- [ ]\n- plain\n")).toEqual(["bulletList"]);
    expect(types("- [ ] **a** b\n")).toEqual(["taskList"]);
    expect(types("- a\n\n  b\n")).toEqual(["bulletList"]);
    expect(types("- [?]\n")).toEqual(["bulletList"]);
    expect(types("- **[ ]**\n")).toEqual(["bulletList"]);
  });

  it("reads empty code blocks", () => {
    expect(parseEditorMarkdown("```\n```\n").blocks[0]?.node).toEqual({
      attrs: { language: null, meta: null },
      content: [],
      type: "codeBlock",
    });
  });

  it("keeps list items that start with a block other than a paragraph as source", () => {
    expect(types("- ```\n  code\n  ```\n")).toEqual(["rawMarkdown"]);
    expect(types("-\n")).toEqual(["bulletList"]);
  });

  it("follows the renderer for callouts and toggles", () => {
    const [toggle] = parseEditorMarkdown(
      "> [!TOGGLE] **Bold** title\n> body\n",
    ).blocks;
    const [titleOnly] = parseEditorMarkdown("> [!TOGGLE]\n").blocks;
    const [callout] = parseEditorMarkdown("> [!NOTE]\n").blocks;

    expect(toggle?.node.content?.[0]).toEqual({
      content: [],
      type: "toggleSummary",
    });
    expect(toggle?.node.content?.[1]?.type).toBe("paragraph");
    expect(titleOnly?.node.content).toEqual([
      { content: [], type: "toggleSummary" },
    ]);
    expect(callout?.node).toEqual({
      attrs: { kind: "note" },
      content: [{ type: "paragraph" }],
      type: "callout",
    });
    expect(types("> - list\n")).toEqual(["blockquote"]);
    expect(types("> **bold**\n")).toEqual(["blockquote"]);
    expect(types(">\n")).toEqual(["blockquote"]);
    expect(types("> [!UNKNOWN] x\n")).toEqual(["blockquote"]);
  });

  it("keeps raw HTML, references and footnotes as source blocks", () => {
    expect(
      types(
        "<div>x</div>\n\na <b>b</b>\n\n[x][y]\n\n[y]: /z\n\nn[^1]\n\n[^1]: f\n",
      ),
    ).toEqual([
      "rawMarkdown",
      "rawMarkdown",
      "rawMarkdown",
      "rawMarkdown",
      "rawMarkdown",
      "rawMarkdown",
    ]);
  });

  it("attaches anchors to the block after them and keeps stray anchors as source", () => {
    const { blocks } = parseEditorMarkdown(
      "<!-- block:a1 -->\npara\n\n<!-- block:b2 -->\n<div>x</div>\n\n<!-- block:c3 -->\n<!-- block:d4 -->\n## h\n\n<!-- block:e5 -->",
    );

    expect(
      blocks.map((block) => [block.node.type, block.node.attrs?.blockId]),
    ).toEqual([
      ["paragraph", "a1"],
      ["rawMarkdown", undefined],
      ["rawMarkdown", undefined],
      ["rawMarkdown", undefined],
      ["heading", "d4"],
      ["rawMarkdown", undefined],
    ]);
  });

  it("pads short table rows and keeps the column alignment", () => {
    const [table] = parseEditorMarkdown(
      "| a | b |\n| :- | - |\n| 1 |\n",
    ).blocks;
    const [, row] = table?.node.content ?? [];

    expect(row?.content).toHaveLength(2);
    expect(table?.node.content?.[0]?.content?.[0]?.attrs).toEqual({
      align: "left",
    });
    expect(
      parseEditorMarkdown("|a|\n|-|\n").blocks[0]?.node.content?.[0]
        ?.content?.[0]?.attrs,
    ).toEqual({ align: null });
  });

  it("reads images with and without marks, titles and alternative text", () => {
    const [block] = parseEditorMarkdown(
      '[![](/wiki/attachments/a)](/x) ![a](/b "t")\n',
    ).blocks;

    expect(block?.node.content).toEqual([
      {
        attrs: { alt: "", src: "/wiki/attachments/a", title: null },
        marks: [{ attrs: { href: "/x", title: null }, type: "link" }],
        type: "image",
      },
      { text: " ", type: "text" },
      { attrs: { alt: "a", src: "/b", title: "t" }, type: "image" },
    ]);
  });

  it("keeps emphasis around inline code as blocks, not as source", () => {
    const { doc: loaded, baseline } = load("**`code`** and _`x`_\n");

    expect(loaded.firstChild?.type.name).toBe("paragraph");
    expect(
      loaded.firstChild?.firstChild?.marks.map((mark) => mark.type.name),
    ).toEqual(["bold", "code"]);
    expect(serializeMarkdown(loaded, baseline)).toBe("**`code`** and _`x`_\n");
  });

  it("does not repeat marks of nested emphasis", () => {
    const [block] = parseEditorMarkdown("**a **b** c**\n").blocks;

    expect(
      block?.node.content?.every((node) => (node.marks ?? []).length === 1),
    ).toBe(true);
  });

  it("keeps a block that does not fit the schema as source", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reduced = getSchema(
      createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS).filter(
        (extension) => extension.name !== "table",
      ),
    );
    const markdown = readMarkdown("| a |\n| - |\n", reduced);

    expect(markdown.content.content?.[0]?.type).toBe("rawMarkdown");
    expect(warn).toHaveBeenCalled();
  });
});

describe("writing markdown", () => {
  it("nests marks as markdown needs them", () => {
    expect(
      write([
        paragraph(
          text("a "),
          text("bold ", [{ type: "bold" }]),
          text("both", [{ type: "bold" }, { type: "italic" }]),
          text(" x", [{ type: "italic" }]),
          text(" "),
          text("gone", [{ type: "strike" }]),
          text(" "),
          text("code", [{ type: "bold" }, { type: "code" }]),
          text(" "),
          text("link", [
            { attrs: { href: "/wiki/p", title: "T" }, type: "link" },
          ]),
          { type: "hardBreak" },
          {
            attrs: { alt: "pic", src: "/wiki/attachments/a", title: null },
            type: "image",
          },
          { attrs: { src: "/x" }, type: "image" },
        ),
      ]),
    ).toBe(
      'a **bold _both_** _x_ ~~gone~~ **`code`** [link](/wiki/p "T")\\\n![pic](/wiki/attachments/a)![](/x)\n',
    );
  });

  it("writes marks of the same length around each other and fills missing attributes", () => {
    expect(
      write([paragraph(text("x", [{ type: "bold" }, { type: "italic" }]))]),
    ).toBe("**_x_**\n");
    expect(
      write([paragraph({ type: "image" }, text("l", [{ type: "link" }]))]),
    ).toBe("![]()[l]()\n");
    expect(
      write([
        {
          attrs: { kind: "" },
          content: [paragraph(text("c"))],
          type: "callout",
        },
      ]),
    ).toBe("> [!NOTE]\n> c\n");
  });

  it("moves blanks out of emphasis and drops empty emphasis and outer blanks", () => {
    expect(
      write([
        paragraph(text("  x"), text(" y ", [{ type: "bold" }]), text("z  ")),
      ]),
    ).toBe("x **y** z\n");
    expect(
      write([
        paragraph(text("a"), text("   ", [{ type: "italic" }]), text("b")),
      ]),
    ).toBe("a   b\n");
    expect(
      write([
        paragraph(
          text(" ", [{ type: "bold" }]),
          { attrs: { src: "/i" }, marks: [{ type: "bold" }], type: "image" },
          text(" ", [{ type: "bold" }]),
        ),
      ]),
    ).toBe("**![](/i)**\n");
  });

  it("writes headings, code, rules, quotes and the table of contents", () => {
    expect(
      write([
        { attrs: { level: 2 }, content: [text("H")], type: "heading" },
        { attrs: { level: 9 }, content: [text("Odd")], type: "heading" },
        {
          attrs: { language: "ts", meta: "x=1" },
          content: [text("a")],
          type: "codeBlock",
        },
        { type: "codeBlock" },
        { type: "horizontalRule" },
        { content: [paragraph(text("q"))], type: "blockquote" },
        { type: "tableOfContents" },
      ]),
    ).toBe(
      "## H\n\n# Odd\n\n```ts x=1\na\n```\n\n```\n```\n\n---\n\n> q\n\n[toc]\n",
    );
  });

  it("writes callouts and toggles with their markers", () => {
    expect(
      write([
        {
          attrs: { kind: "tip" },
          content: [paragraph(text("t"))],
          type: "callout",
        },
        {
          attrs: { kind: "warning" },
          content: [
            {
              content: [{ content: [paragraph(text("i"))], type: "listItem" }],
              type: "bulletList",
            },
          ],
          type: "callout",
        },
        { attrs: { kind: "note" }, content: [paragraph()], type: "callout" },
        {
          content: [
            { content: [text("Sum  mary")], type: "toggleSummary" },
            paragraph(),
            paragraph(text("b")),
          ],
          type: "toggle",
        },
        { content: [{ type: "toggleSummary" }], type: "toggle" },
      ]),
    ).toBe(
      "> [!TIP]\n> t\n\n> [!WARNING]\n>\n> - i\n\n> [!NOTE]\n\n> [!TOGGLE] Sum mary\n>\n> b\n\n> [!TOGGLE]\n",
    );
  });

  it("writes tasks, empty tasks, loose and ordered lists", () => {
    const item = (content: JSONContent[], checked?: boolean): JSONContent =>
      checked === undefined
        ? { content, type: "listItem" }
        : { attrs: { checked }, content, type: "taskItem" };

    expect(
      write([
        {
          content: [
            item([paragraph()], false),
            item([paragraph()], true),
            item([paragraph(text("x"))], true),
          ],
          type: "taskList",
        },
        {
          attrs: { spread: true, start: 3 },
          content: [item([paragraph(text("a"))]), item([paragraph(text("b"))])],
          type: "orderedList",
        },
      ]),
    ).toBe("- [ ]\n- [x]\n- [x] x\n\n3. a\n\n4. b\n");
  });

  it("keeps neighbouring lists of one kind apart with other markers", () => {
    const list = (type: string, value: string): JSONContent => ({
      content: [
        {
          content: [paragraph(text(value))],
          type: type === "taskList" ? "taskItem" : "listItem",
        },
      ],
      type,
    });

    expect(
      write([
        list("bulletList", "a"),
        list("taskList", "b"),
        list("bulletList", "c"),
        list("orderedList", "d"),
        list("orderedList", "e"),
      ]),
    ).toBe("- a\n\n* [ ] b\n\n- c\n\n1. d\n\n1) e\n");
  });

  it("writes tables with alignment and merged cells filled up", () => {
    const cell = (
      type: string,
      value: string,
      attrs: Record<string, unknown> = {},
    ): JSONContent => ({ attrs, content: [paragraph(text(value))], type });
    const lines = write([
      {
        content: [
          {
            content: [
              cell("tableHeader", "a", { align: "center", colspan: 2 }),
              cell("tableHeader", "b", { align: "nonsense" }),
            ],
            type: "tableRow",
          },
          {
            content: [
              cell("tableCell", "1"),
              cell("tableCell", "2"),
              cell("tableCell", "3"),
            ],
            type: "tableRow",
          },
        ],
        type: "table",
      },
    ])
      .trimEnd()
      .split("\n");

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.split("|").length)).toEqual([5, 5, 5]);
    expect(lines[1]).toMatch(/^\| :-+: \| :-+: \| -+ \|$/);
  });

  it("writes source blocks as they are and anchors before their block", () => {
    expect(
      write([
        { content: [text("<b>x</b>")], type: "rawMarkdown" },
        { attrs: { blockId: "a1" }, content: [text("p")], type: "paragraph" },
        { attrs: { blockId: "b2" }, type: "paragraph" },
      ]),
    ).toBe("<b>x</b>\n\n<!-- block:a1 -->\np\n");
  });

  it("writes unknown blocks as paragraphs and drops unknown marks", () => {
    expect(
      write(
        [
          {
            content: [
              text("n", [{ type: "highlight" }]),
              { type: "chip" },
              { content: [text("t")], type: "tag" },
            ],
            type: "note",
          },
        ],
        extendedSchema,
      ),
    ).toBe("nt\n");
  });

  it("returns an empty text for a document of empty paragraphs", () => {
    expect(write([paragraph(), paragraph()])).toBe("");
  });

  it("uses alternate list markers when asked", () => {
    expect(
      stringifyMarkdownBlock(
        {
          children: [
            {
              children: [
                { children: [{ type: "text", value: "a" }], type: "paragraph" },
              ],
              type: "listItem",
            },
          ],
          ordered: false,
          type: "list",
        },
        ALTERNATE_LIST_MARKERS,
      ),
    ).toBe("* a");
  });
});

describe("writing back loaded markdown", () => {
  function edit(
    source: string,
    change: (blocks: JSONContent[]) => JSONContent[],
  ): string {
    const { baseline, doc: loaded } = load(source);
    const json = loaded.toJSON() as JSONContent;

    return serializeMarkdown(doc(change(json.content ?? [])), baseline);
  }

  it("rewrites only the changed block and keeps its neighbours and their spacing", () => {
    expect(
      edit("# H\ntext *em*\n\n\n- a\n", (blocks) => [
        blocks[0] ?? {},
        { content: [{ text: "new", type: "text" }], type: "paragraph" },
        blocks[2] ?? {},
      ]),
    ).toBe("# H\n\nnew\n\n- a\n");
  });

  it("keeps moved blocks exactly and separates them with a blank line", () => {
    expect(
      edit("*a*\n\n__b__\n", (blocks) => [blocks[1] ?? {}, blocks[0] ?? {}]),
    ).toBe("__b__\n\n*a*\n");
  });

  it("writes a duplicated block once as it was and once normalized", () => {
    expect(edit("*a*\n", (blocks) => [blocks[0] ?? {}, blocks[0] ?? {}])).toBe(
      "*a*\n\n_a_\n",
    );
  });

  it("drops the leading blank lines when the first block changed", () => {
    expect(
      edit("\n\n# A\n", () => [
        { content: [{ text: "B", type: "text" }], type: "paragraph" },
      ]),
    ).toBe("B\n");
  });

  it("rewrites the second of two lists that would merge after a deletion", () => {
    expect(
      edit("- a\n\npara\n\n- b\n", (blocks) => [
        blocks[0] ?? {},
        blocks[2] ?? {},
      ]),
    ).toBe("- a\n\n* b\n");
  });

  it("rewrites colliding lists with the default marker after an alternate one", () => {
    expect(
      edit("* a\n\npara\n\n* b\n", (blocks) => [
        blocks[0] ?? {},
        blocks[2] ?? {},
      ]),
    ).toBe("* a\n\n- b\n");
  });

  it("keeps an anchored list as it was next to another list", () => {
    expect(edit("- a\n\n<!-- block:x1 -->\n- b\n", (blocks) => blocks)).toBe(
      "- a\n\n<!-- block:x1 -->\n- b\n",
    );
    expect(
      edit("1. a\n\npara\n\n1) b\n", (blocks) => [
        blocks[0] ?? {},
        blocks[2] ?? {},
      ]),
    ).toBe("1. a\n\n1) b\n");
    expect(edit("1. a\n\n<!-- block:o1 -->\n1. b\n", (blocks) => blocks)).toBe(
      "1. a\n\n<!-- block:o1 -->\n1. b\n",
    );
  });

  it("ignores loaded blocks the document no longer has", () => {
    const markdown = readMarkdown("a\n\nb\n", schema);
    const baseline = createBaseline(markdown, doc([paragraph(text("a"))]));

    expect(baseline.blocks).toHaveLength(1);
    expect(
      serializeMarkdown(
        doc([paragraph(text("a")), paragraph(text("b"))]),
        baseline,
      ),
    ).toBe("a\n\nb\n");
  });
});

describe("clipboard markdown", () => {
  it("writes copied blocks and inline text and skips empty ones", () => {
    expect(
      serializeMarkdownFragment(
        Fragment.fromArray([
          schema.nodeFromJSON({
            attrs: { level: 1 },
            content: [text("H")],
            type: "heading",
          }),
          schema.nodeFromJSON(paragraph()),
          schema.text("inline"),
        ]),
      ),
    ).toBe("# H\n\ninline");
  });

  it("reads one pasted paragraph open and several blocks closed", () => {
    const single = parseMarkdownSlice("**a**", schema);
    const several = parseMarkdownSlice("# a\n\n- b", schema);

    expect([
      single.openStart,
      single.openEnd,
      single.content.childCount,
    ]).toEqual([1, 1, 1]);
    expect([
      several.openStart,
      several.openEnd,
      several.content.childCount,
    ]).toEqual([0, 0, 2]);
  });
});

describe("attribute readers", () => {
  it("reads text, numbers and flags defensively", () => {
    expect(readTextAttribute({ a: "x", b: "", c: 1 }, "a")).toBe("x");
    expect(readTextAttribute({ b: "" }, "b")).toBeNull();
    expect(readTextAttribute({ c: 1 }, "c")).toBeNull();
    expect(readNumberAttribute({ n: 3 }, "n", 1)).toBe(3);
    expect(readNumberAttribute({ n: 1.5 }, "n", 1)).toBe(1);
    expect(readNumberAttribute({}, "n", 7)).toBe(7);
    expect(readFlagAttribute({ f: true }, "f")).toBe(true);
    expect(readFlagAttribute({ f: "true" }, "f")).toBe(false);
  });
});
