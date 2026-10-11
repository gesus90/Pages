import { describe, expect, it } from "vitest";

import {
  resolveAssetPath,
  rewriteRelativeLinks,
} from "@/backend/service/agents/RelativeLinkRewriter";

const assets = new Map([
  ["images/a.png", "image"],
  ["files/a.pdf", "file"],
  ["a(b).png", "paren"],
  ["a&b.png", "entity"],
  ["a b.png", "space"],
]);

describe("relative link rewriting", () => {
  it("changes only asset destinations and retains BOM, CRLF, titles, queries and fragments", () => {
    const content =
      '\ufeff# Heading\r\n\r\n![A](../images/a.png?size=2#top "caption")\r\n\r\n[PDF](<../files/a.pdf#page=2>)\r\n';
    expect(rewriteRelativeLinks("guide/start.md", content, assets)).toEqual({
      content: content
        .replace("../images/a.png?size=2#top", "/agent-assets/image?size=2#top")
        .replace("../files/a.pdf#page=2", "/agent-assets/file#page=2"),
      links: [
        {
          sourceKey: "guide/start.md",
          url: "../images/a.png?size=2#top",
          kind: "image",
          assetId: "image",
          reason: null,
        },
        {
          sourceKey: "guide/start.md",
          url: "../files/a.pdf#page=2",
          kind: "file",
          assetId: "file",
          reason: null,
        },
      ],
    });
  });

  it("rewrites the first used definition once, keeps unused definitions and detects file references", () => {
    const content =
      "![A][pic] ![B][pic]\n\n[PDF][doc]\n\n[pic]: images/a.png\n[pic]: ignored.png\n[doc]: <files/a.pdf> 'Title'\n[unused]: images/a.png\n";
    const result = rewriteRelativeLinks("a.md", content, assets);
    expect(result.content).toBe(
      content
        .replace("[pic]: images/a.png", "[pic]: /agent-assets/image")
        .replace("<files/a.pdf>", "</agent-assets/file>"),
    );
    expect(result.links.map((link) => [link.kind, link.assetId])).toEqual([
      ["image", "image"],
      ["file", "file"],
    ]);
  });

  it("leaves code, HTML, absolute links and page links byte-identical", () => {
    const content = [
      "`![a](images/a.png)`",
      "```md\n![a](images/a.png)\n```",
      '<img src="images/a.png">',
      "[page](other.md#top)",
      "![remote](https://example.invalid/a.png)",
      "[anchor](#same)",
      "![empty]()",
    ].join("\n\n");
    expect(rewriteRelativeLinks("a.md", content, assets)).toEqual({
      content,
      links: [],
    });
  });

  it("deduplicates reports while replacing every occurrence and supports parentheses", () => {
    const result = rewriteRelativeLinks(
      "a.md",
      "![a](images/a.png) ![b](images/a.png) [file](images/a.png) ![paren](a(b).png)",
      assets,
    );
    expect(result.content).toBe(
      "![a](/agent-assets/image) ![b](/agent-assets/image) [file](/agent-assets/image) ![paren](/agent-assets/paren)",
    );
    expect(result.links).toHaveLength(3);
  });

  it.each([
    ["![a](missing.png)", "no_asset"],
    ["![a](../escape.png)", "outside_root"],
    ["![a](%ZZ.png)", "outside_root"],
    ["![a](a\\(b\\).png)", "unsupported_syntax"],
    ["![a](a&amp;b.png)", "unsupported_syntax"],
  ])("retains unresolved syntax and explains it: %s", (content, reason) => {
    const result = rewriteRelativeLinks("a.md", content, assets);
    expect(result.content).toBe(content);
    expect(result.links).toEqual([
      expect.objectContaining({ assetId: null, reason }),
    ]);
  });

  it.each([
    [
      "guide/start.md",
      "../images/a.png?x=1#top",
      { path: "images/a.png", suffix: "?x=1#top" },
    ],
    ["a.md", "./images//a.png", { path: "images/a.png", suffix: "" }],
    ["a.md", "e%CC%81.png", { path: "é.png", suffix: "" }],
    ["a.md", "%00.png", null],
    ["a.md", "%5Cfile.png", null],
    ["a.md", "../file.png", null],
    ["guide/a.md", "..", null],
    ["a.md", "%XX", null],
  ])(
    "resolves clean paths inside the manifest: %s %s",
    (sourceKey, url, expected) => {
      expect(resolveAssetPath(sourceKey, url)).toEqual(expected);
    },
  );
});

it("rewrites angle destinations with spaces", () => {
  expect(rewriteRelativeLinks("a.md", "![a](<a b.png>)", assets).content).toBe(
    "![a](</agent-assets/space>)",
  );
});
