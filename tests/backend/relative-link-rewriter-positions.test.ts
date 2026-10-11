import { expect, it, vi } from "vitest";

import * as scanner from "@/backend/service/agents/RelativeLinkScanner";
import { rewriteRelativeLinks } from "@/backend/service/agents/RelativeLinkRewriter";

import type { Image, Root } from "mdast";

const assets = new Map([
  ["image.png", "asset"],
  ["a(b(c)).png", "nested"],
]);

it("keeps links that a parser supplies without usable source offsets", () => {
  const base: Image = { type: "image", url: "image.png", alt: "A" };
  const point = { line: 1, column: 1 };
  for (const image of [
    base,
    { ...base, position: { start: point, end: point } },
    { ...base, position: { start: { ...point, offset: 0 }, end: point } },
  ]) {
    const tree: Root = { type: "root", children: [image] };
    vi.spyOn(scanner, "parseMarkdown").mockReturnValueOnce(tree);
    expect(rewriteRelativeLinks("a.md", "![A](image.png)", assets)).toEqual({
      content: "![A](image.png)",
      links: [
        {
          sourceKey: "a.md",
          url: "image.png",
          kind: "image",
          assetId: null,
          reason: "unsupported_syntax",
        },
      ],
    });
  }
});

it("keeps destinations that the raw-syntax locator cannot represent", () => {
  const content = "![A](a(b(c)).png)";
  expect(rewriteRelativeLinks("a.md", content, assets)).toMatchObject({
    content,
    links: [{ reason: "unsupported_syntax" }],
  });
  const point = { line: 1, column: 1 };
  for (const raw of ["[pic]:", "not a definition"]) {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "imageReference",
          identifier: "pic",
          referenceType: "full",
          alt: "A",
        },
        {
          type: "definition",
          identifier: "pic",
          url: "image.png",
          position: {
            start: { ...point, offset: 0 },
            end: { ...point, offset: raw.length },
          },
        },
      ],
    };
    vi.spyOn(scanner, "parseMarkdown").mockReturnValueOnce(tree);
    expect(rewriteRelativeLinks("a.md", raw, assets)).toMatchObject({
      content: raw,
      links: [{ reason: "unsupported_syntax" }],
    });
  }
});

it("refuses offsets whose raw destination differs from the parsed address", () => {
  const content = "![A](other.png)";
  const tree: Root = {
    type: "root",
    children: [
      {
        type: "image",
        url: "image.png",
        alt: "A",
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: content.length + 1, offset: content.length },
        },
      },
    ],
  };
  vi.spyOn(scanner, "parseMarkdown").mockReturnValueOnce(tree);
  expect(rewriteRelativeLinks("a.md", content, assets)).toMatchObject({
    content,
    links: [{ reason: "unsupported_syntax" }],
  });
});
