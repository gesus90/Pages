import { describe, expect, it } from "vitest";

import {
  applyEditorCommand,
  continueList,
  replaceEditorRange,
  WIKI_EDITOR_COMMANDS,
} from "@/app/lib/wiki-editor-commands";
import { findEditorTrigger } from "@/app/lib/wiki-editor-triggers";
import { diffLines } from "@/app/lib/wiki-diff";

import type { EditorText } from "@/app/lib/wiki-editor-commands";

function state(value: string, start = value.length, end = start): EditorText {
  return { end, start, value };
}

function selected(result: EditorText): string {
  return result.value.slice(result.start, result.end);
}

describe("editor commands", () => {
  it("wraps a selection or a sample in inline markers", () => {
    expect(applyEditorCommand(state("a word b", 2, 6), "bold")).toMatchObject({
      value: "a **word** b",
    });
    expect(selected(applyEditorCommand(state(""), "italic"))).toBe("italic");
    expect(applyEditorCommand(state(""), "code").value).toBe("`code`");
  });

  it("inserts a link with the address selected", () => {
    const withSelection = applyEditorCommand(state("see docs", 4, 8), "link");

    expect(withSelection.value).toBe("see [docs](https://)");
    expect(selected(withSelection)).toBe("https://");
    expect(applyEditorCommand(state(""), "link").value).toBe(
      "[text](https://)",
    );
  });

  it("toggles line prefixes over every selected line", () => {
    const on = applyEditorCommand(state("a\nb\nc", 0, 3), "bullet");

    expect(on.value).toBe("- a\n- b\nc");
    expect(applyEditorCommand(on, "bullet").value).toBe("a\nb\nc");
    expect(applyEditorCommand(state("x"), "heading2").value).toBe("## x");
    expect(applyEditorCommand(state("x"), "task").value).toBe("- [ ] x");
    expect(applyEditorCommand(state("x"), "quote").value).toBe("> x");
    expect(applyEditorCommand(state("x"), "heading1").value).toBe("# x");
    expect(applyEditorCommand(state("x"), "heading3").value).toBe("### x");
  });

  it("keeps the caret behind the prefix instead of selecting the line", () => {
    const empty = applyEditorCommand(state(""), "heading2");
    const inside = applyEditorCommand(state("abc", 2), "bullet");
    const removed = applyEditorCommand(state("- abc", 4), "bullet");
    const front = applyEditorCommand(state("- abc", 1), "bullet");
    const numbered = applyEditorCommand(state("abc", 3), "numbered");

    expect([empty.start, empty.end]).toEqual([3, 3]);
    expect([inside.start, inside.end]).toEqual([4, 4]);
    expect([removed.start, removed.end]).toEqual([2, 2]);
    expect([front.start, front.end]).toEqual([0, 0]);
    expect([numbered.start, numbered.end]).toEqual([6, 6]);
  });

  it("numbers lines and removes the numbers again", () => {
    const on = applyEditorCommand(state("a\nb", 0, 3), "numbered");

    expect(on.value).toBe("1. a\n2. b");
    expect(applyEditorCommand(on, "numbered").value).toBe("a\nb");
  });

  it("inserts blocks into an empty line or below the current line", () => {
    const empty = applyEditorCommand(state(""), "callout");

    expect(empty.value).toBe("> [!NOTE]\n> text");
    expect(selected(empty)).toBe("text");

    const below = applyEditorCommand(state("first line", 3), "divider");

    expect(below.value).toBe("first line\n---");
    expect(below.start).toBe(below.value.length);

    const middle = applyEditorCommand(state("a\n\nb", 2), "table");

    expect(middle.value.startsWith("a\n| Column 1")).toBe(true);
    expect(applyEditorCommand(state(""), "toggle").value).toContain(
      "[!TOGGLE]",
    );
    expect(selected(applyEditorCommand(state(""), "codeBlock"))).toBe("code");
    expect(applyEditorCommand(state(""), "contents").value).toBe("[toc]");
  });

  it("knows every command", () => {
    for (const command of WIKI_EDITOR_COMMANDS) {
      expect(() => applyEditorCommand(state("x"), command)).not.toThrow();
    }
  });

  it("continues bullet, numbered and task lists and ends them on an empty item", () => {
    expect(continueList(state("- a"))?.value).toBe("- a\n- ");
    expect(continueList(state("  * a"))?.value).toBe("  * a\n  * ");
    expect(continueList(state("3. a"))?.value).toBe("3. a\n4. ");
    expect(continueList(state("- [x] done"))?.value).toBe("- [x] done\n- [ ] ");
    expect(continueList(state("x\n- "))?.value).toBe("x\n");
    expect(continueList(state("plain"))).toBeNull();
    expect(continueList(state("- a", 0, 3))).toBeNull();
  });

  it("replaces a range and puts the caret behind it", () => {
    expect(replaceEditorRange(state("ab/cd"), 2, 3, "XY")).toEqual({
      end: 4,
      start: 4,
      value: "abXYcd",
    });
  });
});

describe("editor triggers", () => {
  it("finds a slash only at the start of a line", () => {
    expect(findEditorTrigger("/he", 3)).toEqual({
      from: 0,
      kind: "slash",
      query: "he",
      to: 3,
    });
    expect(findEditorTrigger("a\n  /", 5)).toMatchObject({
      kind: "slash",
      query: "",
    });
    expect(findEditorTrigger("a /he", 5)).toBeNull();
  });

  it("finds [[ and @ anywhere", () => {
    expect(findEditorTrigger("see [[Pla", 9)).toEqual({
      from: 4,
      kind: "reference",
      query: "Pla",
      to: 9,
    });
    expect(findEditorTrigger("hi @ann", 7)).toMatchObject({
      from: 3,
      kind: "reference",
      query: "ann",
    });
    expect(findEditorTrigger("(@x", 3)).toMatchObject({ query: "x" });
    expect(findEditorTrigger("mail@x", 6)).toBeNull();
    expect(findEditorTrigger("[[a]] done", 10)).toBeNull();
    expect(findEditorTrigger("plain", 5)).toBeNull();
  });
});

describe("diffLines", () => {
  it("marks added, removed and unchanged lines", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });

  it("handles identical and empty texts", () => {
    expect(diffLines("same", "same")).toEqual([{ kind: "same", text: "same" }]);
    expect(diffLines("", "")).toEqual([{ kind: "same", text: "" }]);
    expect(diffLines("a", "")).toEqual([
      { kind: "removed", text: "a" },
      { kind: "added", text: "" },
    ]);
  });
});
