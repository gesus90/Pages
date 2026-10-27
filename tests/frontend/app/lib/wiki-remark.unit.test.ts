import { describe, expect, it } from "vitest";

import {
  BLOCK_ANCHOR_PATTERN,
  WIKI_CALLOUT_KINDS,
  remarkWikiBlocks,
} from "@/app/lib/wiki-remark";

type Node = Parameters<ReturnType<typeof remarkWikiBlocks>>[0];

function text(value: string): Node {
  return { type: "text", value };
}

function paragraph(...children: Node[]): Node {
  return { type: "paragraph", children };
}

function quote(...children: Node[]): Node {
  return { type: "blockquote", children };
}

function transform(root: Node): Node {
  remarkWikiBlocks()(root);
  return root;
}

function firstOf(node: Node): Node {
  const [first] = node.children ?? [];
  if (!first) throw new Error("The node has no children.");
  return first;
}

describe("wiki callouts", () => {
  it.each(WIKI_CALLOUT_KINDS)(
    "marks a %s quote and removes its marker",
    (kind) => {
      const root = transform({
        type: "root",
        children: [
          quote(paragraph(text(`[!${kind.toUpperCase()}]\nRead this.`))),
        ],
      });

      const callout = firstOf(root);
      expect(callout.data).toEqual({
        hProperties: { "data-wiki-callout": kind },
      });
      expect(firstOf(firstOf(callout)).children).toBeUndefined();
      expect(firstOf(firstOf(callout)).value).toBe("Read this.");
    },
  );

  it("removes a marker that is followed by nothing but spaces", () => {
    const root = transform({
      type: "root",
      children: [quote(paragraph(text("[!note]   ")))],
    });

    expect(firstOf(firstOf(firstOf(root))).value).toBe("");
  });

  it("leaves an unknown marker, a plain quote and an empty quote alone", () => {
    const unknown = quote(paragraph(text("[!banana] text")));
    const plain = quote(paragraph(text("just a quote")));
    const empty = quote();
    const noText = quote(
      paragraph({ type: "emphasis", children: [text("x")] }),
    );
    const noParagraph = quote({ type: "list", children: [] });
    const childless: Node = { type: "blockquote" };
    const hollowParagraph = quote({ type: "paragraph" });

    transform({
      type: "root",
      children: [
        unknown,
        plain,
        empty,
        noText,
        noParagraph,
        childless,
        hollowParagraph,
      ],
    });

    for (const untouched of [
      unknown,
      plain,
      empty,
      noText,
      noParagraph,
      childless,
      hollowParagraph,
    ])
      expect(untouched.data).toBeUndefined();
    expect(firstOf(firstOf(unknown)).value).toBe("[!banana] text");
  });
});

describe("wiki toggles", () => {
  it("turns a toggle into a details element with the first line as summary", () => {
    const root = transform({
      type: "root",
      children: [
        quote(
          paragraph(text("[!toggle] Title line\nHidden body")),
          paragraph(text("More")),
        ),
      ],
    });

    const toggle = firstOf(root);
    const [summary, body, more] = toggle.children ?? [];
    expect(toggle.data).toEqual({ hName: "details" });
    expect(summary).toEqual({
      type: "paragraph",
      data: { hName: "summary" },
      children: [text("Title line")],
    });
    expect(firstOf(body ?? text("")).value).toBe("Hidden body");
    expect(more?.type).toBe("paragraph");
  });

  it("drops the first paragraph when the marker line was all it held", () => {
    const root = transform({
      type: "root",
      children: [
        quote(paragraph(text("[!toggle] Only title")), paragraph(text("Body"))),
      ],
    });

    const children = firstOf(root).children ?? [];
    expect(children).toHaveLength(2);
    expect(firstOf(children[1] ?? text("")).value).toBe("Body");
  });

  it("keeps the first paragraph when inline markup follows the marker line", () => {
    const root = transform({
      type: "root",
      children: [
        quote(
          paragraph(text("[!toggle] Title"), {
            type: "emphasis",
            children: [text("em")],
          }),
        ),
      ],
    });

    expect(firstOf(root).children).toHaveLength(2);
  });
});

describe("wiki contents and block anchors", () => {
  it("turns a paragraph that only holds [toc] into a navigation element", () => {
    const root = transform({
      type: "root",
      children: [
        paragraph(text(" [TOC] ")),
        paragraph(text("[toc] and more")),
        paragraph(text("a"), text("b")),
      ],
    });

    const [toc, other, several] = root.children ?? [];
    expect(toc).toMatchObject({
      data: { hName: "nav", hProperties: { "data-wiki-toc": "true" } },
      children: [],
    });
    expect(other?.data).toBeUndefined();
    expect(several?.data).toBeUndefined();
    expect(transform(paragraph()).data).toBeUndefined();
    expect(transform({ type: "paragraph" }).data).toBeUndefined();
  });

  it("turns an invisible block comment into a scroll target and ignores other HTML", () => {
    const anchor: Node = { type: "html", value: " <!-- block:abc123 --> " };
    const comment: Node = { type: "html", value: "<!-- other -->" };
    const markup: Node = { type: "html", value: "<div>hi</div>" };
    const blank: Node = { type: "html" };

    transform({ type: "root", children: [anchor, comment, markup, blank] });

    expect(anchor).toMatchObject({
      type: "paragraph",
      value: undefined,
      children: [],
      data: {
        hName: "span",
        hProperties: { className: "block scroll-mt-20", id: "block-abc123" },
      },
    });
    expect([comment.type, markup.type, blank.type]).toEqual([
      "html",
      "html",
      "html",
    ]);
  });

  it("matches only well-formed block anchors", () => {
    expect(BLOCK_ANCHOR_PATTERN.test("<!--block:a1-->")).toBe(true);
    expect(BLOCK_ANCHOR_PATTERN.test("<!-- block:A1 -->")).toBe(false);
    expect(BLOCK_ANCHOR_PATTERN.test(`<!-- block:${"a".repeat(33)} -->`)).toBe(
      false,
    );
  });

  it("visits nested nodes", () => {
    const nested = paragraph(text("[toc]"));
    transform({
      type: "root",
      children: [{ type: "listItem", children: [nested] }],
    });

    expect(nested.data?.hName).toBe("nav");
  });
});
