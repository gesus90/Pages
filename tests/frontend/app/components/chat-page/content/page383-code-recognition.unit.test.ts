import { afterEach, describe, expect, it, vi } from "vitest";

import { detectCodeLanguage } from "@/app/components/chat-page/content/code-detection";
import {
  readCsv,
  selectCsvRows,
  splitCsv,
} from "@/app/components/chat-page/content/csv-parse";
import { readJson } from "@/app/components/chat-page/content/json-parse";
import { parseMessageContent } from "@/app/components/chat-page/content/message-content";
import {
  buildPreviewDocument,
  canSendFromPreview,
  readPreviewSend,
} from "@/app/components/chat-page/content/preview-document";
import { createZipArchive } from "@/app/components/chat-page/content/preview-download";
import {
  codeKindLabel,
  previewKindOf,
} from "@/app/components/chat-page/content/preview-kinds";

describe("recognition of a fence without language (PAGE-383)", () => {
  it.each([
    ["SELECT id, name\nFROM users\nWHERE active = true;", "sql"],
    ['{"name": "Ada", "tags": ["a", "b"]}', "json"],
    ['<div class="box">\n  <button>Go</button>\n</div>', "html"],
    ["<!doctype html>\n<html><body>Hi</body></html>", "html"],
    ['<svg viewBox="0 0 10 10"><circle r="4"/></svg>', "svg"],
    ["graph TD\n  A --> B", "mermaid"],
    ["sequenceDiagram\n  Ada->>Ed: Hallo", "mermaid"],
    ["name,age,city\nAda,36,London\nEd,41,Bonn", "csv"],
    ["name;age\nAda;36\nEd;41", "csv"],
    ["name\tage\nAda\t36", "tsv"],
    [
      "def greet(name):\n    print(name)\n\nif __name__ == \"__main__\":\n    greet('x')",
      "python",
    ],
    ["#!/bin/bash\necho hi", "shell"],
    ["npm install\npnpm run build", "shell"],
    [
      "interface User {\n  name: string;\n}\nconst user: User = { name: 'x' };",
      "typescript",
    ],
    [
      "const total = items.reduce((sum, item) => sum + item, 0);\nconsole.log(total);",
      "javascript",
    ],
    [".card {\n  color: red;\n  padding: 4px;\n}", "css"],
    ["name: pages\nversion: 2\nservices:\n  - web", "yaml"],
    ["# Title\n\n- one\n- two\n\n**bold** text", "markdown"],
    ["diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b", "diff"],
  ])("recognizes %j as %s", (source, language) => {
    expect(detectCodeLanguage(source)).toBe(language);
  });

  it.each([
    ["Just a sentence of plain text."],
    ["hello world\nanother line"],
    [""],
    ["SELECT a;\nSELECT b;".replace("SELECT", "pick")],
  ])("keeps unclear content %j as plain text", (source) => {
    expect(detectCodeLanguage(source)).toBeNull();
  });
});

describe("parts of a message (PAGE-383)", () => {
  it("marks a recognized block, while an explicit language always wins", () => {
    expect(parseMessageContent("```\nSELECT id FROM t;\n```")).toEqual([
      {
        kind: "code",
        name: "",
        languageHint: "sql",
        source: "SELECT id FROM t;",
        isDetected: true,
      },
    ]);
    expect(parseMessageContent("```text\nSELECT id FROM t;\n```")).toEqual([
      {
        kind: "code",
        name: "",
        languageHint: "text",
        source: "SELECT id FROM t;",
      },
    ]);
    expect(parseMessageContent("```\nplain words only\n```")).toEqual([
      { kind: "code", name: "", languageHint: "", source: "plain words only" },
    ]);
    expect(parseMessageContent("```\n# Title\n\n- a\n- b\n```")).toEqual([
      { kind: "markdown", source: "# Title\n\n- a\n- b", isDetected: true },
    ]);
  });

  it("joins an HTML block with the CSS and JavaScript blocks of the message into one preview", () => {
    const parts = parseMessageContent(
      [
        "Hier die Oberfläche:",
        "```html",
        "<button id=b>Go</button>",
        "```",
        "```css",
        "button { color: red; }",
        "```",
        "```js",
        "document.getElementById('b').onclick = () => {};",
        "```",
        "```python",
        "print(1)",
        "```",
      ].join("\n"),
    );
    expect(parts.map((part) => part.kind)).toEqual(["text", "preview", "code"]);
    const preview = parts[1];
    expect(preview?.kind === "preview" ? preview.files : []).toEqual([
      {
        name: "index.html",
        languageHint: "html",
        source: "<button id=b>Go</button>",
      },
      {
        name: "style.css",
        languageHint: "css",
        source: "button { color: red; }",
      },
      {
        name: "app.js",
        languageHint: "js",
        source: "document.getElementById('b').onclick = () => {};",
      },
    ]);
  });

  it("names preview kinds and their labels", () => {
    expect(previewKindOf("html")).toBe("html");
    expect(previewKindOf("diagram.mmd")).toBe("mermaid");
    expect(previewKindOf("tsv")).toBe("tsv");
    expect(previewKindOf("ts")).toBeNull();
    expect(codeKindLabel("mermaid")).toBe("Mermaid");
    expect(codeKindLabel("sql")).toBe("SQL");
  });
});

describe("the sandboxed preview document (PAGE-383)", () => {
  it("puts styles into the head, scripts at the end of the body and the bridge first", () => {
    const html = buildPreviewDocument([
      {
        name: "index.html",
        languageHint: "html",
        source:
          "<html><head><title>x</title></head><body><p>Hi</p></body></html>",
      },
      { name: "style.css", languageHint: "css", source: "p{color:red}" },
      { name: "app.js", languageHint: "js", source: "var s = '</script>';" },
    ]);
    const bridge = html.indexOf('Object.defineProperty(window,"pages"');
    expect(bridge).toBeGreaterThan(-1);
    expect(bridge).toBeLessThan(html.indexOf("<title>"));
    expect(html.indexOf("<style>p{color:red}</style>")).toBeLessThan(
      html.indexOf("</head>"),
    );
    expect(html).toContain("<script>var s = '<\\/script>';</script></body>");
  });

  it("wraps a fragment and an SVG into whole documents", () => {
    const fragment = buildPreviewDocument([
      { name: "index.html", languageHint: "html", source: "<p>Hi</p>" },
    ]);
    expect(fragment.startsWith("<!doctype html><html><head>")).toBe(true);
    expect(fragment).toContain("<body><p>Hi</p></body>");
    const svg = buildPreviewDocument([
      { name: "a.svg", languageHint: "svg", source: "<svg></svg>" },
    ]);
    expect(svg).toContain("<body><svg></svg></body>");
    expect(svg).toContain("place-items:center");
  });

  it("accepts only send messages with text", () => {
    expect(readPreviewSend({ type: "pages-preview:send", text: "  B  " })).toBe(
      "B",
    );
    expect(
      readPreviewSend({ type: "pages-preview:send", text: "   " }),
    ).toBeNull();
    expect(readPreviewSend({ type: "other", text: "B" })).toBeNull();
    expect(readPreviewSend("B")).toBeNull();
    expect(
      readPreviewSend({ type: "pages-preview:send", text: "x".repeat(5000) })
        ?.length,
    ).toBe(4000);
  });
});

describe("the check before a preview writes into the chat (PAGE-383)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function focusedFrame(): HTMLIFrameElement {
    const frame = document.createElement("iframe");
    frame.tabIndex = 0;
    document.body.append(frame);
    frame.focus();
    return frame;
  }

  it("needs the focus in the frame, a fresh user activation and a second since the last message", () => {
    const frame = focusedFrame();
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: true },
    });
    expect(canSendFromPreview({ frame, lastSentAt: 0, now: 10_000 })).toBe(
      true,
    );
    expect(canSendFromPreview({ frame, lastSentAt: 9_500, now: 10_000 })).toBe(
      false,
    );
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: false },
    });
    expect(canSendFromPreview({ frame, lastSentAt: 0, now: 10_000 })).toBe(
      false,
    );
  });

  it("refuses without focus in the frame and without the activation interface", () => {
    const frame = focusedFrame();
    vi.stubGlobal("navigator", { ...navigator, userActivation: undefined });
    expect(canSendFromPreview({ frame, lastSentAt: 0, now: 10_000 })).toBe(
      false,
    );
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: true },
    });
    frame.blur();
    expect(canSendFromPreview({ frame, lastSentAt: 0, now: 10_000 })).toBe(
      false,
    );
  });
});

describe("JSON, CSV and the archive (PAGE-383)", () => {
  it("reads valid JSON and names the place of an error", () => {
    expect(readJson('{"a": [1, 2]}')).toEqual({
      isValid: true,
      value: { a: [1, 2] },
    });
    const broken = readJson('{\n  "a": 1,\n  "b": }');
    expect(broken.isValid).toBe(false);
    expect(broken.isValid ? null : [broken.line, broken.column]).toEqual([
      3, 8,
    ]);
    const unclosed = readJson("[1, 2");
    expect(unclosed.isValid ? null : [unclosed.line, unclosed.column]).toEqual([
      1, 6,
    ]);
  });

  it("recognizes the delimiter, keeps quoted fields and fills short rows", () => {
    expect(readCsv("a;b\n1;2\n3;4", "csv").delimiter).toBe(";");
    expect(readCsv("a\tb\n1\t2", "tsv").delimiter).toBe("\t");
    expect(splitCsv('name,quote\nAda,"Hi, ""you"""\n', ",")).toEqual([
      ["name", "quote"],
      ["Ada", 'Hi, "you"'],
    ]);
    expect(readCsv("a,b,c\n1,2,3\n4", "csv").rows[1]).toEqual(["4", "", ""]);
  });

  it("filters rows by the search and sorts numbers as numbers", () => {
    const rows = [
      ["Ada", "10"],
      ["Ed", "9"],
      ["Mei", "100"],
    ];
    expect(
      selectCsvRows(rows, {
        query: "",
        sort: { column: 1, direction: "ascending" },
      }),
    ).toEqual([
      ["Ed", "9"],
      ["Ada", "10"],
      ["Mei", "100"],
    ]);
    expect(
      selectCsvRows(rows, {
        query: "e",
        sort: { column: 0, direction: "descending" },
      }),
    ).toEqual([
      ["Mei", "100"],
      ["Ed", "9"],
    ]);
  });

  it("packs several files into a ZIP archive with local headers, a directory and its end", () => {
    const archive = createZipArchive([
      { name: "index.html", source: "<p>Hi</p>" },
      { name: "style.css", source: "p{}" },
    ]);
    const view = new DataView(archive.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = archive.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    expect(new TextDecoder().decode(archive.slice(30, 40))).toBe("index.html");
    // CRC-32 of "<p>Hi</p>"
    expect(view.getUint32(14, true)).toBe(0x6a9bd753);
  });
});
