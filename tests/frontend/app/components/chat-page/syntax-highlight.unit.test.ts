import { describe, expect, it } from "vitest";

import {
  highlightLines,
  resolveSyntaxLanguage,
  syntaxLanguageLabel,
} from "../../../../../app/components/chat-page/content/syntax-highlight";

describe("syntax language hints", () => {
  it.each([
    [" src/components/view.TSX ", "typescript", "TypeScript"],
    ["C:\\code\\script.js", "typescript", "JavaScript"],
    ["bash title=terminal", "shell", "Shell"],
    [".jsonc", "json", "JSON"],
    ["file.py", "python", "Python"],
    ["style.css", "css", "CSS"],
    ["page.xml", "html", "XML"],
    ["image.svg", "html", "SVG"],
    ["readme.mdx", "markdown", "Markdown"],
    ["config.yml", "yaml", "YAML"],
    ["change.patch", "diff", "Diff"],
    ["query.sql", "sql", "SQL"],
    ["constructor", null, "constructor"],
    ["  unknown  ", null, "unknown"],
    ["", null, ""],
  ])("resolves %s", (hint, language, label) => {
    expect(resolveSyntaxLanguage(hint)).toBe(language);
    expect(syntaxLanguageLabel(hint)).toBe(label);
  });
});

describe("highlightLines", () => {
  it("preserves plain lines and strips carriage returns", () => {
    expect(highlightLines("hello\r\n\nworld\r", null)).toEqual([
      [{ kind: "plain", text: "hello" }],
      [],
      [{ kind: "plain", text: "world" }],
    ]);
  });

  it("classifies code and carries comments and template strings across lines", () => {
    expect(
      highlightLines(
        "const x = 12.5; call(x); // note\n/* open\nstill */ let s = `a\nb`;",
        "typescript",
      ),
    ).toEqual([
      [
        { kind: "keyword", text: "const" },
        { kind: "plain", text: " x = " },
        { kind: "number", text: "12.5" },
        { kind: "plain", text: "; " },
        { kind: "function", text: "call" },
        { kind: "plain", text: "(x); " },
        { kind: "comment", text: "// note" },
      ],
      [{ kind: "comment", text: "/* open" }],
      [
        { kind: "comment", text: "still */" },
        { kind: "plain", text: " " },
        { kind: "keyword", text: "let" },
        { kind: "plain", text: " s = " },
        { kind: "string", text: "`a" },
      ],
      [
        { kind: "string", text: "b`" },
        { kind: "plain", text: ";" },
      ],
    ]);
  });

  it("distinguishes JSON keys, escaped strings, values and comments", () => {
    expect(
      highlightLines('{"key" : "a\\"b", "n": 42, "ok": true} // end', "json"),
    ).toEqual([
      [
        { kind: "plain", text: "{" },
        { kind: "function", text: '"key"' },
        { kind: "plain", text: " : " },
        { kind: "string", text: '"a\\"b"' },
        { kind: "plain", text: ", " },
        { kind: "function", text: '"n"' },
        { kind: "plain", text: ": " },
        { kind: "number", text: "42" },
        { kind: "plain", text: ", " },
        { kind: "function", text: '"ok"' },
        { kind: "plain", text: ": " },
        { kind: "keyword", text: "true" },
        { kind: "plain", text: "} " },
        { kind: "comment", text: "// end" },
      ],
    ]);
  });
});

describe("highlightLines: shell and SQL", () => {
  it("recognizes shell comments only at boundaries and carries quoted strings", () => {
    expect(highlightLines("echo a#b # note\n'first\nsecond'", "shell")).toEqual(
      [
        [
          { kind: "keyword", text: "echo" },
          { kind: "plain", text: " a#b " },
          { kind: "comment", text: "# note" },
        ],
        [{ kind: "string", text: "'first" }],
        [{ kind: "string", text: "second'" }],
      ],
    );
  });

  it("recognizes case-insensitive SQL and multiline Python strings", () => {
    expect(highlightLines("SELECT count(id) FROM t -- end", "sql")).toEqual([
      [
        { kind: "keyword", text: "SELECT" },
        { kind: "plain", text: " " },
        { kind: "function", text: "count" },
        { kind: "plain", text: "(id) " },
        { kind: "keyword", text: "FROM" },
        { kind: "plain", text: " t " },
        { kind: "comment", text: "-- end" },
      ],
    ]);
    expect(
      highlightLines('def f():\n  """first\nlast""" # end', "python"),
    ).toEqual([
      [
        { kind: "keyword", text: "def" },
        { kind: "plain", text: " " },
        { kind: "function", text: "f" },
        { kind: "plain", text: "():" },
      ],
      [
        { kind: "plain", text: "  " },
        { kind: "string", text: '"""first' },
      ],
      [
        { kind: "string", text: 'last"""' },
        { kind: "plain", text: " " },
        { kind: "comment", text: "# end" },
      ],
    ]);
  });

  it("distinguishes CSS properties from selectors", () => {
    expect(highlightLines("a:hover { color: red; margin: 0 }", "css")).toEqual([
      [
        { kind: "plain", text: "a:hover { " },
        { kind: "keyword", text: "color" },
        { kind: "plain", text: ": red; " },
        { kind: "keyword", text: "margin" },
        { kind: "plain", text: ": " },
        { kind: "number", text: "0" },
        { kind: "plain", text: " }" },
      ],
    ]);
  });
});

describe("highlightLines: structured text", () => {
  it("highlights YAML mapping keys and boundary comments", () => {
    expect(
      highlightLines(
        "- name: yes\n  url: https://x#part # note\n  # comment",
        "yaml",
      ),
    ).toEqual([
      [
        { kind: "plain", text: "- " },
        { kind: "function", text: "name" },
        { kind: "plain", text: ": " },
        { kind: "keyword", text: "yes" },
      ],
      [
        { kind: "plain", text: "  " },
        { kind: "function", text: "url" },
        { kind: "plain", text: ": https://x#part " },
        { kind: "comment", text: "# note" },
      ],
      [
        { kind: "plain", text: "  " },
        { kind: "comment", text: "# comment" },
      ],
    ]);
  });

  it("scans markup tags, attributes and multiline comments", () => {
    expect(
      highlightLines(
        'text <a href="url" disabled=x>hi</a>\n<!-- open\nclose --> end',
        "html",
      ),
    ).toEqual([
      [
        { kind: "plain", text: "text <" },
        { kind: "keyword", text: "a" },
        { kind: "plain", text: " " },
        { kind: "function", text: "href" },
        { kind: "plain", text: "=" },
        { kind: "string", text: '"url"' },
        { kind: "plain", text: " " },
        { kind: "function", text: "disabled" },
        { kind: "plain", text: "=" },
        { kind: "string", text: "x" },
        { kind: "plain", text: ">hi</" },
        { kind: "keyword", text: "a" },
        { kind: "plain", text: ">" },
      ],
      [{ kind: "comment", text: "<!-- open" }],
      [
        { kind: "comment", text: "close -->" },
        { kind: "plain", text: " end" },
      ],
    ]);
  });
});

describe("highlightLines: Markdown and diff", () => {
  it("handles Markdown headings, links, inline code and fenced blocks", () => {
    expect(
      highlightLines(
        "# Heading\n> quote\nSee [link](url) and `code`.\n~~~js\nconst x = 1\n~~~\nafter",
        "markdown",
      ),
    ).toEqual([
      [{ kind: "keyword", text: "# Heading" }],
      [{ kind: "comment", text: "> quote" }],
      [
        { kind: "plain", text: "See " },
        { kind: "function", text: "[link](url)" },
        { kind: "plain", text: " and " },
        { kind: "string", text: "`code`" },
        { kind: "plain", text: "." },
      ],
      [{ kind: "string", text: "~~~js" }],
      [{ kind: "string", text: "const x = 1" }],
      [{ kind: "string", text: "~~~" }],
      [{ kind: "plain", text: "after" }],
    ]);
  });

  it("classifies diff headers, hunks and changed lines", () => {
    expect(
      highlightLines(
        "diff --git a b\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n context\n",
        "diff",
      ),
    ).toEqual([
      [{ kind: "comment", text: "diff --git a b" }],
      [{ kind: "comment", text: "--- a" }],
      [{ kind: "comment", text: "+++ b" }],
      [{ kind: "keyword", text: "@@ -1 +1 @@" }],
      [{ kind: "number", text: "-old" }],
      [{ kind: "string", text: "+new" }],
      [{ kind: "plain", text: " context" }],
      [],
    ]);
  });
});
