import { describe, expect, it } from "vitest";

import { remarkWikiBlocks } from "@/app/lib/wiki-remark";

type Node = Parameters<ReturnType<typeof remarkWikiBlocks>>[0];

function transform(tree: Node): Node {
  remarkWikiBlocks()(tree);

  return tree;
}

function quote(...children: Node[]): Node {
  return { children, type: "blockquote" };
}

function paragraph(...children: Node[]): Node {
  return { children, type: "paragraph" };
}

function text(value?: string): Node {
  return value === undefined ? { type: "text" } : { type: "text", value };
}

describe("remarkWikiBlocks", () => {
  it("leaves quotes without a leading text alone", () => {
    expect(transform({ type: "blockquote" }).data).toBeUndefined();
    expect(transform(quote({ type: "list" })).data).toBeUndefined();
    expect(transform(quote({ type: "paragraph" })).data).toBeUndefined();
    expect(
      transform(quote(paragraph({ type: "emphasis" }))).data,
    ).toBeUndefined();
    expect(transform(quote(paragraph(text()))).data).toBeUndefined();
  });

  it("marks a quote with a known kind as callout and strips the marker", () => {
    const leading = text("[!TIP]\nbody");
    const tree = transform(quote(paragraph(leading)));

    expect(tree.data?.hProperties).toEqual({ "data-wiki-callout": "tip" });
    expect(leading.value).toBe("body");
  });

  it("keeps quotes with an unknown kind or without a marker", () => {
    const unknown = text("[!FOO] body");

    expect(transform(quote(paragraph(unknown))).data).toBeUndefined();
    expect(unknown.value).toBe("[!FOO] body");
    expect(transform(quote(paragraph(text("plain")))).data).toBeUndefined();
  });

  it("turns a toggle into details with a summary", () => {
    const tree = transform(quote(paragraph(text("[!TOGGLE] Title\nbody"))));

    expect(tree.data).toEqual({ hName: "details" });
    expect(tree.children?.[0]).toMatchObject({
      children: [{ type: "text", value: "Title" }],
      data: { hName: "summary" },
    });
    expect(tree.children?.[1]?.children?.[0]?.value).toBe("body");
  });

  it("turns a toggle without a body line into a summary only", () => {
    const leading = text("[!toggle] Only");

    transform(quote(paragraph(leading)));

    expect(leading.value).toBe("");
  });

  it("marks a paragraph with only [toc] as the contents marker", () => {
    const tree = transform(paragraph(text(" [TOC] ")));

    expect(tree.data).toEqual({
      hName: "nav",
      hProperties: { "data-wiki-toc": "true" },
    });
    expect(tree.children).toEqual([]);
  });

  it("leaves other paragraphs alone", () => {
    expect(transform(paragraph(text("[toc] and more"))).data).toBeUndefined();
    expect(transform(paragraph(text("[toc]"), text("x"))).data).toBeUndefined();
    expect(transform(paragraph({ type: "emphasis" })).data).toBeUndefined();
    expect(transform({ type: "paragraph" }).data).toBeUndefined();
  });

  it("visits nested nodes", () => {
    const inner = text("[!NOTE]\nx");
    const tree = transform({
      children: [{ children: [quote(paragraph(inner))], type: "list" }],
      type: "root",
    });

    expect(tree.children?.[0]?.children?.[0]?.data?.hProperties).toEqual({
      "data-wiki-callout": "note",
    });
  });
});
