// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, expect, it, vi } from "vitest";

import {
  anchorBlock,
  BLOCK_KINDS,
  createPlainTextSlice,
  deleteBlock,
  duplicateBlock,
  findSelectedBlock,
  findTopLevelBlock,
  insertBlock,
  INSERT_ONLY_KINDS,
  moveBlock,
  selectBlock,
  startUndoStep,
  turnBlockInto,
} from "@/app/lib/editor/editor-commands";
import {
  readMarkdown,
  serializeMarkdown,
} from "@/app/lib/editor/editor-markdown";

import { createEditorExtensions, EDITOR_TEST_SCHEMA } from "./editor-fixture";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** A headless editor holding the given markdown. */
function open(markdown: string): Editor {
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: readMarkdown(markdown, EDITOR_TEST_SCHEMA).content,
  });
  editors.push(editor);
  return editor;
}

/** The markdown the editor holds now. */
function markdownOf(editor: Editor): string {
  return serializeMarkdown(editor.state.doc, null);
}

/** The type names of the top-level blocks. */
function blockTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.forEach((block) => types.push(block.type.name));
  return types;
}

it("names the block kinds of the menus", () => {
  expect(BLOCK_KINDS).toContain("toggle");
  expect(INSERT_ONLY_KINDS).toEqual(["divider", "table", "contents"]);
});

it("finds the top-level block at a position and nothing outside the document", () => {
  const { doc } = open("A\n\nBB\n\nC").state;

  expect(findTopLevelBlock(doc, -1)).toBeNull();
  expect(findTopLevelBlock(doc, doc.content.size)).toBeNull();
  expect(findTopLevelBlock(doc, 0)).toMatchObject({ index: 0, position: 0 });
  expect(findTopLevelBlock(doc, 5)).toMatchObject({ index: 1, position: 3 });
  expect(findTopLevelBlock(doc, 8)?.node.textContent).toBe("C");
});

it("finds the block of the selection", () => {
  const editor = open("A\n\nBB");
  editor.commands.setTextSelection(5);

  expect(findSelectedBlock(editor)).toMatchObject({ index: 1, position: 3 });
});

it("puts the caret into a text block and selects blocks without text whole", () => {
  const editor = open("A\n\n---\n\n| a |\n| - |\n| b |\n\nB");

  selectBlock(editor, 3);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(editor.state.selection.from).toBe(3);

  selectBlock(editor, 4);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(editor.state.selection.from).toBe(4);

  const last = editor.state.doc.content.size - 3;
  selectBlock(editor, last);
  expect(editor.state.selection).toBeInstanceOf(TextSelection);
  expect(editor.state.selection.from).toBe(last + 1);

  const before = editor.state.selection;
  selectBlock(editor, 999);
  expect(editor.state.selection).toBe(before);
});

it("turns a block into every kind of block", () => {
  const expected: Readonly<Record<string, string>> = {
    paragraph: "Text\n",
    heading1: "# Text\n",
    heading2: "## Text\n",
    heading3: "### Text\n",
    bulletList: "- Text\n",
    orderedList: "1. Text\n",
    taskList: "- [ ] Text\n",
    quote: "> Text\n",
    callout: "> [!NOTE]\n> Text\n",
    codeBlock: "```\nText\n```\n",
    toggle: "> [!TOGGLE] Text\n",
  };

  for (const kind of BLOCK_KINDS) {
    const editor = open("## Text");
    editor.commands.setTextSelection(2);

    expect(turnBlockInto(editor, kind)).toBe(true);
    expect([kind, markdownOf(editor)]).toEqual([kind, expected[kind]]);
  }
});

it("turns an empty block into a toggle with an empty title", () => {
  const editor = open("A\n\n ");
  editor.commands.setContent({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  editor.commands.setTextSelection(1);

  expect(turnBlockInto(editor, "toggle")).toBe(true);
  expect(editor.state.doc.firstChild?.type.name).toBe("toggle");
  expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(0);
  expect(editor.state.selection.from).toBe(2);
});

it("does not wrap a selected block without text into a toggle", () => {
  const editor = open("---");
  editor.commands.setNodeSelection(0);

  expect(turnBlockInto(editor, "toggle")).toBe(false);
  expect(blockTypes(editor)).toEqual(["horizontalRule"]);
});

it("inserts dividers, tables and the table of contents", () => {
  const divider = open("A");
  divider.commands.setTextSelection(2);
  expect(insertBlock(divider, "divider")).toBe(true);
  expect(blockTypes(divider)).toContain("horizontalRule");

  const table = open("A");
  table.commands.setTextSelection(2);
  expect(insertBlock(table, "table")).toBe(true);
  expect(blockTypes(table)).toContain("table");

  const contents = open("A");
  contents.commands.setTextSelection(2);
  expect(insertBlock(contents, "contents")).toBe(true);
  expect(blockTypes(contents)).toEqual([
    "paragraph",
    "tableOfContents",
    "paragraph",
  ]);

  const heading = open("A");
  heading.commands.setTextSelection(1);
  expect(insertBlock(heading, "heading1")).toBe(true);
  expect(markdownOf(heading)).toBe("# A\n");
});

it("starts a new undo step so undo reverts only the next change", () => {
  const editor = open("A");
  editor.commands.insertContentAt(2, "b");
  startUndoStep(editor);
  editor.commands.insertContentAt(3, "c");

  editor.commands.undo();

  expect(markdownOf(editor)).toBe("Ab\n");
});

it("duplicates a block below itself without its anchor", () => {
  const editor = open("<!-- block:abc -->\nA\n\nB");

  expect(duplicateBlock(editor, 999)).toBe(false);
  expect(duplicateBlock(editor, 0)).toBe(true);
  expect(markdownOf(editor)).toBe("<!-- block:abc -->\nA\n\nA\n\nB\n");
  expect(editor.state.selection.from).toBe(4);

  expect(duplicateBlock(editor, 6)).toBe(true);
  expect(markdownOf(editor)).toBe("<!-- block:abc -->\nA\n\nA\n\nB\n\nB\n");
});

it("deletes a block and keeps one empty paragraph after the last", () => {
  const editor = open("A\n\nB");

  expect(deleteBlock(editor, 999)).toBe(false);
  expect(deleteBlock(editor, 3)).toBe(true);
  expect(markdownOf(editor)).toBe("A\n");
  expect(deleteBlock(editor, 0)).toBe(true);
  expect(blockTypes(editor)).toEqual(["paragraph"]);
  expect(markdownOf(editor)).toBe("");
});

it("moves a block up and down with the caret inside it", () => {
  const editor = open("A\n\nBB\n\nC");
  editor.commands.setTextSelection(5);

  expect(moveBlock(editor, 3, "up")).toBe(true);
  expect(markdownOf(editor)).toBe("BB\n\nA\n\nC\n");
  expect(editor.state.selection.from).toBe(2);

  expect(moveBlock(editor, 0, "down")).toBe(true);
  expect(markdownOf(editor)).toBe("A\n\nBB\n\nC\n");
  expect(editor.state.selection.from).toBe(5);
});

it("keeps a selected block selected while it moves", () => {
  const editor = open("A\n\n---");
  editor.commands.setNodeSelection(3);

  expect(moveBlock(editor, 3, "up")).toBe(true);
  expect(blockTypes(editor)).toEqual(["horizontalRule", "paragraph"]);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(editor.state.selection.from).toBe(0);
});

it("does not move the first block up, the last down or a missing block", () => {
  const editor = open("A\n\nB");

  expect(moveBlock(editor, 0, "up")).toBe(false);
  expect(moveBlock(editor, 3, "down")).toBe(false);
  expect(moveBlock(editor, 999, "down")).toBe(false);
  expect(markdownOf(editor)).toBe("A\n\nB\n");
});

it("gives a block a new random anchor and keeps an existing one", () => {
  vi.spyOn(crypto, "getRandomValues").mockImplementation(
    <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array)
        array.set([0, 1, 25, 26, 35, 36, 61, 62]);
      return array;
    },
  );
  const editor = open("A\n\n<!-- block:kept -->\nB");

  expect(anchorBlock(editor, 0)).toBe("abz09az0");
  expect(anchorBlock(editor, 3)).toBe("kept");
  expect(markdownOf(editor)).toBe(
    "<!-- block:abz09az0 -->\nA\n\n<!-- block:kept -->\nB\n",
  );
  editor.commands.undo();
  expect(markdownOf(editor)).toContain("block:abz09az0");
});

it("gives no anchor outside the document or to a source block", () => {
  const editor = open("<div>raw</div>");

  expect(anchorBlock(editor, 999)).toBeNull();
  expect(anchorBlock(editor, 0)).toBeNull();
});

it("builds one plain paragraph per pasted line", () => {
  const slice = createPlainTextSlice("a *b*\r\n\rc", EDITOR_TEST_SCHEMA);
  const lines: string[] = [];
  slice.content.forEach((node) => lines.push(node.textContent));

  expect(lines).toEqual(["a *b*", "", "c"]);
  expect([slice.openStart, slice.openEnd]).toEqual([1, 1]);
});
