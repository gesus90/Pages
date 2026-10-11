import { describe, expect, it } from "vitest";

import { scanRelativeLinks } from "@/backend/service/agents/RelativeLinkScanner";

describe("relative import asset mentions", () => {
  it("lists images and file links, including used reference links, without treating Markdown page links as assets", () => {
    const content = [
      '![image](images/screenshot.png "caption")',
      "[PDF](../files/manual.pdf#page=2)",
      "[archive](files/package.zip?download=1)",
      "![reference image][pic] [reference file][doc]",
      "[pic]: images/reference.png",
      "[doc]: files/reference.pdf",
      "[doc]: files/ignored-duplicate.pdf",
      "[unused]: files/unused.pdf",
      "[page](other.md#chapter) [page upper](other.MD?x=1)",
      "[page without fragment](other.md)",
    ].join("\n\n");
    expect(scanRelativeLinks("guide/start.md", content)).toEqual([
      {
        sourceKey: "guide/start.md",
        url: "images/screenshot.png",
        kind: "image",
      },
      {
        sourceKey: "guide/start.md",
        url: "../files/manual.pdf#page=2",
        kind: "file",
      },
      {
        sourceKey: "guide/start.md",
        url: "files/package.zip?download=1",
        kind: "file",
      },
      {
        sourceKey: "guide/start.md",
        url: "images/reference.png",
        kind: "image",
      },
      { sourceKey: "guide/start.md", url: "files/reference.pdf", kind: "file" },
    ]);
  });

  it("ignores code, HTML, remote/internal URLs, fragments and unused references", () => {
    const content = [
      "`![inert](secret.png)`",
      "```md\n[code](secret.pdf)\n```",
      '<img src="html.png">',
      "![https](https://remote.invalid/a.png)",
      "[protocol-relative](//remote.invalid/a.pdf)",
      "[mail](mailto:user@example.invalid)",
      "![data](data:image/png;base64,AAAA)",
      "[page](/wiki/id) [asset](/agent-assets/id)",
      "[anchor](#same-page) [query](?x=1)",
      "[empty]() ![empty]() [unresolved][missing]",
      "[unused]: unused.pdf",
      "[windows](C:\\file.pdf)",
    ].join("\n\n");
    expect(scanRelativeLinks("source.md", content)).toEqual([]);
  });

  it("deduplicates identical mentions but preserves the distinct image/file uses", () => {
    expect(
      scanRelativeLinks(
        "a.md",
        "![a](x.png) ![b](x.png) [download](x.png) [again](x.png)",
      ),
    ).toEqual([
      { sourceKey: "a.md", url: "x.png", kind: "image" },
      { sourceKey: "a.md", url: "x.png", kind: "file" },
    ]);
  });
});
