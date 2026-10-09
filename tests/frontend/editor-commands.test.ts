// @vitest-environment jsdom
import { undoDepth } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  anchorBlock,
  createPlainTextSlice,
  deleteBlock,
  duplicateBlock,
  findSelectedBlock,
  findTopLevelBlock,
  insertBlock,
  moveBlock,
  selectBlock,
  startUndoStep,
  turnBlockInto,
} from "@/app/lib/editor/editor-commands";
import { serializeMarkdown } from "@/app/lib/editor/editor-markdown";

import {
  createTestEditor,
  installEditorGeometry,
  typeText,
} from "../helpers/editor";

import type { Editor } from "@tiptap/core";
import type { BlockKind } from "@/app/lib/editor/editor-commands";

let editors: Editor[] = [];

function open(markdown: string): Editor {
  const editor = createTestEditor(markdown);

  editors.push(editor);

  return editor;
}

const markdownOf = (editor: Editor): string =>
  serializeMarkdown(editor.state.doc, null);

function caretAt(editor: Editor, position: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, position),
    ),
  );
}

beforeAll(installEditorGeometry);

afterEach(() => {
  editors.forEach((editor) => editor.destroy());
  editors = [];
});

describe("turning blocks into other blocks", () => {
  it.each<[BlockKind, string]>([
    ["paragraph", "Hello\n"],
    ["heading1", "# Hello\n"],
    ["heading2", "## Hello\n"],
    ["heading3", "### Hello\n"],
    ["bulletList", "- Hello\n"],
    ["orderedList", "1. Hello\n"],
    ["taskList", "- [ ] Hello\n"],
    ["quote", "> Hello\n"],
    ["callout", "> [!NOTE]\n> Hello\n"],
    ["toggle", "> [!TOGGLE] Hello\n"],
    ["codeBlock", "```\nHello\n```\n"],
  ])("turns a heading into %s as one undo step", (kind, expected) => {
    const editor = open("## Hello\n");

    caretAt(editor, 3);
    expect(turnBlockInto(editor, kind)).toBe(true);
    expect(markdownOf(editor)).toBe(expected);
    editor.commands.undo();
    expect(markdownOf(editor)).toBe("## Hello\n");
  });

  it("puts the caret behind the summary of a new toggle", () => {
    const editor = open("Hello\n");

    caretAt(editor, 2);
    turnBlockInto(editor, "toggle");

    expect(editor.state.selection.$from.parent.type.name).toBe("toggleSummary");
    expect(editor.state.selection.$from.parentOffset).toBe(5);
  });

  it("turns an empty paragraph into an empty toggle and refuses blocks without text", () => {
    const empty = open("\n");

    turnBlockInto(empty, "toggle");
    expect(empty.state.doc.firstChild?.type.name).toBe("toggle");

    const rule = open("---\n");

    rule.view.dispatch(
      rule.state.tr.setSelection(NodeSelection.create(rule.state.doc, 0)),
    );
    expect(turnBlockInto(rule, "toggle")).toBe(false);
  });
});

describe("inserting blocks", () => {
  it("inserts a divider, a table and a table of contents", () => {
    const divider = open("a\n");
    const table = open("a\n");
    const contents = open("a\n");

    expect(insertBlock(divider, "divider")).toBe(true);
    expect(insertBlock(table, "table")).toBe(true);
    expect(insertBlock(contents, "contents")).toBe(true);
    expect(markdownOf(divider)).toContain("---");
    expect(table.$node("table")).not.toBeNull();
    expect(markdownOf(contents)).toContain("[toc]");
  });

  it("applies block types through the same command as turning into", () => {
    const editor = open("a\n");

    insertBlock(editor, "heading2");
    expect(markdownOf(editor)).toBe("## a\n");
  });
});

describe("block actions", () => {
  it("duplicates a block below itself without its anchor", () => {
    const editor = open("<!-- block:a1 -->\none\n\ntwo\n");

    expect(duplicateBlock(editor, 0)).toBe(true);
    expect(markdownOf(editor)).toBe("<!-- block:a1 -->\none\n\none\n\ntwo\n");
    expect(duplicateBlock(editor, editor.state.doc.content.size - 5)).toBe(
      true,
    );
    expect(markdownOf(editor)).toBe(
      "<!-- block:a1 -->\none\n\none\n\ntwo\n\ntwo\n",
    );
    expect(duplicateBlock(editor, 999)).toBe(false);
  });

  it("deletes a block, keeps one paragraph in an empty document and ignores other places", () => {
    const editor = open("one\n\ntwo\n");

    expect(deleteBlock(editor, 0)).toBe(true);
    expect(markdownOf(editor)).toBe("two\n");
    expect(deleteBlock(editor, 0)).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(deleteBlock(editor, -1)).toBe(false);
  });

  it("moves blocks up and down with the caret and stops at the edges", () => {
    const editor = open("one\n\ntwo\n\nthree\n");
    const second = findTopLevelBlock(editor.state.doc, 6)?.position ?? -1;

    caretAt(editor, second + 2);
    expect(moveBlock(editor, second, "up")).toBe(true);
    expect(markdownOf(editor)).toBe("two\n\none\n\nthree\n");
    expect(editor.state.selection.$from.parent.textContent).toBe("two");
    expect(moveBlock(editor, 0, "up")).toBe(false);
    expect(moveBlock(editor, 0, "down")).toBe(true);
    expect(markdownOf(editor)).toBe("one\n\ntwo\n\nthree\n");
    expect(moveBlock(editor, editor.state.doc.content.size - 7, "down")).toBe(
      false,
    );
    expect(moveBlock(editor, 999, "down")).toBe(false);
  });

  it("keeps a selected block selected while it moves", () => {
    const editor = open("a\n\n---\n");

    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 3)),
    );
    moveBlock(editor, 3, "up");

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.doc.firstChild?.type.name).toBe("horizontalRule");
  });

  it("gives a block an anchor once and keeps it", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint8Array).fill(1);

      return array;
    });
    const editor = open("a\n\n<div>x</div>\n");

    expect(anchorBlock(editor, 0)).toBe("bbbbbbbb");
    expect(anchorBlock(editor, 0)).toBe("bbbbbbbb");
    expect(markdownOf(editor)).toBe(
      "<!-- block:bbbbbbbb -->\na\n\n<div>x</div>\n",
    );
    expect(editor.can().undo()).toBe(false);
    expect(anchorBlock(editor, 5)).toBeNull();
    expect(anchorBlock(editor, 999)).toBeNull();
  });
});

describe("finding and selecting blocks", () => {
  it("finds top-level blocks and the selected one", () => {
    const editor = open("one\n\n- a\n- b\n");

    expect(findTopLevelBlock(editor.state.doc, 0)?.index).toBe(0);
    expect(findTopLevelBlock(editor.state.doc, 9)?.index).toBe(1);
    expect(findTopLevelBlock(editor.state.doc, -1)).toBeNull();
    expect(
      findTopLevelBlock(editor.state.doc, editor.state.doc.content.size),
    ).toBeNull();
    caretAt(editor, 9);
    expect(findSelectedBlock(editor)?.position).toBe(5);
  });

  it("selects the text of a block, or a whole block without text", () => {
    const editor = open("text\n\n---\n\n| a |\n| - |\n");

    selectBlock(editor, 0);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    selectBlock(editor, 6);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    selectBlock(editor, 7);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe(
      "table",
    );
    selectBlock(editor, 999);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe(
      "table",
    );
  });
});

describe("undo steps and plain text", () => {
  it("separates a command from the typing before it", () => {
    const editor = open("\n");

    typeText(editor, "abc");
    startUndoStep(editor);
    insertBlock(editor, "heading1");
    expect(undoDepth(editor.state)).toBe(2);
    editor.commands.undo();
    expect(markdownOf(editor)).toBe("abc\n");
  });

  it("builds plain paragraphs from pasted lines", () => {
    const editor = open("\n");
    const slice = createPlainTextSlice("a **b**\r\n\r\nc", editor.schema);

    expect(slice.content.childCount).toBe(3);
    expect(slice.content.child(0).textContent).toBe("a **b**");
    expect(slice.content.child(1).childCount).toBe(0);
    expect([slice.openStart, slice.openEnd]).toEqual([1, 1]);
  });
});
