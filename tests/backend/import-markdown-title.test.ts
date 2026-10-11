import { describe, expect, it, vi } from "vitest";

import { readImportTitle } from "@/backend/service/agents/ImportMarkdownTitle";

import type { Root } from "mdast";

describe("import title precedence", () => {
  it("uses a normalized explicit title before any H1", () => {
    expect(
      readImportTitle({
        sourceKey: "guide/a.md",
        content: "# H1",
        title: "  Explicit\n title  ",
      }),
    ).toEqual({
      sourceKey: "guide/a.md",
      title: "Explicit title",
      titleSource: "explicit",
    });
  });

  it("uses the first top-level H1 with inline text and leaves code, H2, quoted headings and frontmatter inert", () => {
    const content =
      "---\ntitle: ignored\n---\n\n```md\n# Code\n```\n\n> # Quoted\n\n## H2\n\n# **First** `H1` [link](https://example.invalid) ![alt](a.png) <span>text</span>\n\n# Later";
    expect(readImportTitle({ sourceKey: "guide/a.md", content })).toEqual({
      sourceKey: "guide/a.md",
      title: "First H1 link alt text",
      titleSource: "h1",
    });
    expect(content).toContain("title: ignored");
  });

  it("supports setext H1, line breaks and reference image alt text", () => {
    expect(
      readImportTitle({
        sourceKey: "a.md",
        content: "First  \nsecond ![alt][pic]\n=====\n\n[pic]: pic.png",
      }),
    ).toMatchObject({ title: "First second alt", titleSource: "h1" });
    expect(readImportTitle({ sourceKey: "a.md", content: "#" })).toMatchObject({
      title: "",
      titleSource: "h1",
    });
  });

  it("falls back to the filename without its Markdown extension", () => {
    expect(
      readImportTitle({
        sourceKey: "folder/no heading.MD",
        content: "body\n\n## H2",
      }),
    ).toEqual({
      sourceKey: "folder/no heading.MD",
      title: "no heading",
      titleSource: "filename",
    });
  });

  it("handles a parser image node without alternative text", async () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "image", url: "image.png", alt: null }],
        },
      ],
    };
    const pipeline = { use: () => pipeline, parse: () => tree };
    vi.resetModules();
    vi.doMock("unified", () => ({ unified: () => pipeline }));
    try {
      const isolated =
        await import("@/backend/service/agents/ImportMarkdownTitle");
      expect(
        isolated.readImportTitle({
          sourceKey: "a.md",
          content: "# ![](image.png)",
        }),
      ).toMatchObject({ title: "", titleSource: "h1" });
    } finally {
      vi.doUnmock("unified");
      vi.resetModules();
    }
  });
});
