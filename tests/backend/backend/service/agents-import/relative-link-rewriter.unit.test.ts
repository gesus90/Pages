import { describe, expect, it } from "vitest";

import {
  assetLink,
  resolveAssetPath,
  rewriteRelativeLinks,
} from "@/backend/service/agents/RelativeLinkRewriter";

describe("assetLink", () => {
  it("names the authenticated file address of an asset", () => {
    expect(assetLink("asset-1")).toBe("/agent-assets/asset-1");
  });
});

describe("resolveAssetPath", () => {
  it.each([
    ["docs/guide.md", "img/a.png", "docs/img/a.png"],
    ["docs/guide.md", "./img/a.png", "docs/img/a.png"],
    ["docs/guide.md", "../img/a.png", "img/a.png"],
    ["guide.md", "a.png", "a.png"],
    ["docs/deep/guide.md", "../../a.png", "a.png"],
    ["docs/guide.md", "img//a.png", "docs/img/a.png"],
    ["docs/guide.md", "my%20pic.png", "docs/my pic.png"],
    ["guide.md", "café.png", "café.png"],
    ["guide.md", "café.png", "café.png"],
  ])("resolves %s + %s to %s", (sourceKey, url, path) => {
    expect(resolveAssetPath(sourceKey, url)).toEqual({ path, suffix: "" });
  });

  it("keeps the query and fragment as written", () => {
    expect(resolveAssetPath("docs/a.md", "f.pdf?v=2#page=3")).toEqual({
      path: "docs/f.pdf",
      suffix: "?v=2#page=3",
    });
    expect(resolveAssetPath("docs/a.md", "f.pdf#top")).toEqual({
      path: "docs/f.pdf",
      suffix: "#top",
    });
  });

  it.each([
    ["leaving the root from a subfolder", "docs/guide.md", "../../a.png"],
    ["leaving the root from the top", "guide.md", "../a.png"],
    ["an invalid percent sequence", "guide.md", "bad%E0%A4%A.png"],
    ["a backslash", "guide.md", "dir\\a.png"],
    ["an encoded backslash", "guide.md", "dir%5Ca.png"],
    ["an encoded NUL", "guide.md", "a%00.png"],
    ["an encoded newline", "guide.md", "a%0A.png"],
    ["only a dot", "guide.md", "."],
    ["an empty target", "guide.md", ""],
  ])("refuses %s", (_, sourceKey, url) => {
    expect(resolveAssetPath(sourceKey, url)).toBeNull();
  });
});

const ASSETS = new Map([
  ["img/a.png", "asset-a"],
  ["img/b.png", "asset-b-longer-identifier"],
  ["files/manual.pdf", "asset-m"],
]);

describe("rewriteRelativeLinks of images and files", () => {
  it("replaces an image destination and reports its outcome", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "Before ![Logo](img/a.png) after",
      ASSETS,
    );
    expect(result.content).toBe("Before ![Logo](/agent-assets/asset-a) after");
    expect(result.links).toEqual([
      {
        sourceKey: "guide.md",
        url: "img/a.png",
        kind: "image",
        assetId: "asset-a",
        reason: null,
      },
    ]);
  });

  it("replaces a file link and keeps the fragment", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "[Manual](files/manual.pdf#page=2)",
      ASSETS,
    );
    expect(result.content).toBe("[Manual](/agent-assets/asset-m#page=2)");
    expect(result.links[0]).toMatchObject({ kind: "file", assetId: "asset-m" });
  });

  it("resolves links against the folder of the source", () => {
    const result = rewriteRelativeLinks(
      "docs/guide.md",
      "![a](../img/a.png)",
      ASSETS,
    );
    expect(result.content).toBe("![a](/agent-assets/asset-a)");
  });

  it("keeps the title and the angle brackets of a destination", () => {
    const assets = new Map([["my pic.png", "asset-p"]]);
    const result = rewriteRelativeLinks(
      "guide.md",
      '![a](<my pic.png> "A title")',
      assets,
    );
    expect(result.content).toBe('![a](</agent-assets/asset-p> "A title")');
  });

  it("matches an encoded destination by its decoded path", () => {
    const assets = new Map([["my pic.png", "asset-p"]]);
    const result = rewriteRelativeLinks(
      "guide.md",
      "![a](my%20pic.png)",
      assets,
    );
    expect(result.content).toBe("![a](/agent-assets/asset-p)");
  });

  it("changes only the destination when the alt text repeats the path", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "![img/a.png](img/a.png) and [see (img/a.png)](img/a.png)",
      ASSETS,
    );
    expect(result.content).toBe(
      "![img/a.png](/agent-assets/asset-a) and [see (img/a.png)](/agent-assets/asset-a)",
    );
  });

  it("applies several edits of different length to the right places", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "😀 ![a](img/a.png)\n\n![b](img/b.png) [m](files/manual.pdf)",
      ASSETS,
    );
    expect(result.content).toBe(
      "😀 ![a](/agent-assets/asset-a)\n\n![b](/agent-assets/asset-b-longer-identifier) [m](/agent-assets/asset-m)",
    );
  });

  it("keeps a byte order mark and Windows line endings", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "﻿# T\r\n\r\n![a](img/a.png)\r\n",
      ASSETS,
    );
    expect(result.content).toBe("﻿# T\r\n\r\n![a](/agent-assets/asset-a)\r\n");
  });

  it("rewrites every occurrence but reports a link once per kind and target", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "![a](img/a.png) ![again](img/a.png) [file](img/a.png)",
      ASSETS,
    );
    expect(result.content).toBe(
      "![a](/agent-assets/asset-a) ![again](/agent-assets/asset-a) [file](/agent-assets/asset-a)",
    );
    expect(result.links.map((link) => link.kind)).toEqual(["image", "file"]);
  });
});

describe("rewriteRelativeLinks of reference definitions", () => {
  it("rewrites the definition of a used image reference", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "![Logo][logo]\n\n[logo]: img/a.png\n",
      ASSETS,
    );
    expect(result.content).toBe(
      "![Logo][logo]\n\n[logo]: /agent-assets/asset-a\n",
    );
    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toMatchObject({
      kind: "image",
      assetId: "asset-a",
    });
  });

  it("treats a definition used by a link reference as a file", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "[Manual][m]\n\n[m]: files/manual.pdf\n",
      ASSETS,
    );
    expect(result.links[0]).toMatchObject({ kind: "file", assetId: "asset-m" });
  });

  it("ignores a definition nothing refers to", () => {
    const source = "Text\n\n[unused]: img/a.png\n";
    const result = rewriteRelativeLinks("guide.md", source, ASSETS);
    expect(result).toEqual({ content: source, links: [] });
  });

  it("uses only the first of two definitions with the same label", () => {
    const result = rewriteRelativeLinks(
      "guide.md",
      "![x][l]\n\n[l]: img/a.png\n[l]: img/b.png\n",
      ASSETS,
    );
    expect(result.content).toBe(
      "![x][l]\n\n[l]: /agent-assets/asset-a\n[l]: img/b.png\n",
    );
    expect(result.links).toHaveLength(1);
  });
});

describe("rewriteRelativeLinks leaving links alone", () => {
  it.each([
    ["an absolute URL", "![a](https://example.test/img/a.png)"],
    ["an absolute path", "![a](/img/a.png)"],
    ["an anchor", "[a](#section)"],
    ["a mailto address", "[a](mailto:person@example.test)"],
    ["a link to another page", "[a](other.md)"],
    ["a page link with a fragment", "[a](other.md#intro)"],
  ])("does not touch or report %s", (_, source) => {
    expect(rewriteRelativeLinks("guide.md", source, ASSETS)).toEqual({
      content: source,
      links: [],
    });
  });

  it.each([
    ["a fenced code block", "```\n![a](img/a.png)\n```"],
    ["an indented code block", "    ![a](img/a.png)"],
    ["inline code", "Use `![a](img/a.png)` here"],
    ["raw HTML", '<img src="img/a.png">'],
  ])("does not touch %s", (_, source) => {
    expect(rewriteRelativeLinks("guide.md", source, ASSETS)).toEqual({
      content: source,
      links: [],
    });
  });

  it("reports a link without a staged asset and leaves it as written", () => {
    const source = "![a](img/missing.png)";
    expect(rewriteRelativeLinks("guide.md", source, ASSETS)).toEqual({
      content: source,
      links: [
        {
          sourceKey: "guide.md",
          url: "img/missing.png",
          kind: "image",
          assetId: null,
          reason: "no_asset",
        },
      ],
    });
  });

  it("reports a link that leaves the manifest root", () => {
    const source = "![a](../../secret.png)";
    const result = rewriteRelativeLinks("docs/guide.md", source, ASSETS);
    expect(result.content).toBe(source);
    expect(result.links[0]).toMatchObject({
      assetId: null,
      reason: "outside_root",
    });
  });

  it.each([
    ["a character reference", "![a](a&amp;b.png)", "a&b.png"],
    ["a backslash escape", "![a](a\\_b.png)", "a_b.png"],
  ])("leaves a destination with %s unchanged", (_, source, path) => {
    const assets = new Map([[path, "asset-x"]]);
    const result = rewriteRelativeLinks("guide.md", source, assets);
    expect(result.content).toBe(source);
    expect(result.links[0]).toMatchObject({
      assetId: null,
      reason: "unsupported_syntax",
    });
  });

  it("returns an empty source unchanged", () => {
    expect(rewriteRelativeLinks("guide.md", "", ASSETS)).toEqual({
      content: "",
      links: [],
    });
  });
});
