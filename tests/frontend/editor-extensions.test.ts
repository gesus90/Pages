// @vitest-environment jsdom
import { GapCursor } from "@tiptap/pm/gapcursor";
import { undoDepth } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Editor, getSchema } from "@tiptap/core";

import {
  createSchemaExtensions,
  HEADLESS_SCHEMA_OPTIONS,
} from "@/app/components/editor/editor-extensions";
import {
  EditorKeymap,
  separateShortcutStep,
} from "@/app/components/editor/extensions/editor-keymap";
import { removeDuplicateAnchors } from "@/app/components/editor/extensions/markdown-attributes";
import { breakRawMarkdownLine } from "@/app/components/editor/extensions/raw-markdown-node";
import {
  enterToggleBody,
  unwrapToggle,
} from "@/app/components/editor/extensions/toggle-node";
import { AttachmentImageNode } from "@/app/components/editor/extensions/attachment-image-node";
import {
  readMarkdown,
  serializeMarkdown,
} from "@/app/lib/editor/editor-markdown";

import {
  createTestEditor,
  installEditorGeometry,
  pressKey,
  typeText,
} from "../helpers/editor";

import type { TestEditorOptions } from "../helpers/editor";

let editors: Editor[] = [];

function open(markdown: string, keymap?: TestEditorOptions["keymap"]): Editor {
  const editor = createTestEditor(markdown, { keymap });

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

describe("toggles", () => {
  it("opens the toggle and starts its content when Enter is pressed in the summary", () => {
    const editor = open("> [!TOGGLE] Title\n> body\n");

    caretAt(editor, 4);
    expect(enterToggleBody(editor)).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.open).toBe(true);
    expect(editor.state.doc.firstChild?.child(1).childCount).toBe(0);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(pressKey(editor, "Enter")).toBe(true);
  });

  it("leaves Enter alone outside the summary and with a selection", () => {
    const editor = open("> [!TOGGLE] Title\n\nplain\n");

    caretAt(editor, editor.state.doc.content.size - 2);
    expect(enterToggleBody(editor)).toBe(false);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 2, 5),
      ),
    );
    expect(enterToggleBody(editor)).toBe(false);
  });

  it("turns a toggle back into blocks with Backspace at the start of its summary", () => {
    const editor = open("> [!TOGGLE] Title\n> body\n");

    caretAt(editor, 2);
    expect(unwrapToggle(editor)).toBe(true);
    expect(markdownOf(editor)).toBe("Title\n\nbody\n");
    expect(editor.state.selection.from).toBe(1);
  });

  it("unwraps through the Backspace key as well", () => {
    const editor = open("> [!TOGGLE] Title\n");

    caretAt(editor, 2);
    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(markdownOf(editor)).toBe("Title\n");
  });

  it("keeps Backspace for other places", () => {
    const editor = open("> [!TOGGLE] Title\n\nplain\n");

    caretAt(editor, 4);
    expect(unwrapToggle(editor)).toBe(false);
    caretAt(editor, editor.state.doc.content.size - 2);
    expect(unwrapToggle(editor)).toBe(false);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 2, 5),
      ),
    );
    expect(unwrapToggle(editor)).toBe(false);
  });
});

describe("schema defaults", () => {
  it("offers neutral texts and shows no images without an application", () => {
    expect(HEADLESS_SCHEMA_OPTIONS.checkboxLabel(true)).toBe("");
    expect(
      HEADLESS_SCHEMA_OPTIONS.isDisplayableImage("/wiki/attachments/a"),
    ).toBe(false);
    expect(AttachmentImageNode.options.isDisplayable("/x")).toBe(false);
  });

  it("names the checkbox of every task", () => {
    const label = vi.fn((checked: boolean) => (checked ? "done" : "open"));
    const editor = new Editor({
      content: readMarkdown(
        "- [x] a\n- [ ] b\n",
        getSchema(createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS)),
      ).content,
      element: document.body.appendChild(document.createElement("div")),
      extensions: createSchemaExtensions({
        ...HEADLESS_SCHEMA_OPTIONS,
        checkboxLabel: label,
      }),
    });

    editors.push(editor);
    expect(label).toHaveBeenCalledWith(true);
    expect(label).toHaveBeenCalledWith(false);
  });
});

describe("source blocks", () => {
  it("breaks lines with Enter inside a source block only", () => {
    const editor = open("<div>\nx\n</div>\n\nafter\n");

    caretAt(editor, 6);
    expect(breakRawMarkdownLine(editor)).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe("<div>\n\nx\n</div>");
    caretAt(editor, editor.state.doc.content.size - 2);
    expect(breakRawMarkdownLine(editor)).toBe(false);
  });
});

describe("HTML of the markdown blocks", () => {
  it("reads pasted HTML into the special blocks and attributes", () => {
    const editor = open("\n");

    editor.commands.setContent(
      [
        '<div data-callout="warning"><p>w</p></div>',
        '<div data-callout="bogus"><p>b</p></div>',
        "<details open><summary>S</summary><p>body</p></details>",
        "<pre data-raw-markdown><code>&lt;b&gt;</code></pre>",
        "<pre><code>plain code</code></pre>",
        "<nav data-table-of-contents></nav>",
        '<p data-block-id="a1">anchored <a href="/wiki/x" title="T">link</a> <img src="/wiki/attachments/i" alt="pic"></p>',
        '<table><tr><th style="text-align: center">h</th><th>g</th></tr><tr><td style="text-align: right">c</td><td style="text-align: justify">d</td></tr></table>',
      ].join(""),
    );

    expect(markdownOf(editor)).toBe(
      '> [!WARNING]\n> w\n\n> [!NOTE]\n> b\n\n> [!TOGGLE] S\n>\n> body\n\n<b>\n\n```\nplain code\n```\n\n[toc]\n\n<!-- block:a1 -->\nanchored [link](/wiki/x "T") ![pic](/wiki/attachments/i)\n\n|  h  | g |\n| :-: | - |\n|  c  | d |\n',
    );
    expect(editor.state.doc.child(2).attrs.open).toBe(true);
  });

  it("writes the attributes into the HTML of the document", () => {
    const editor = open(
      '> [!TIP]\n> t\n\n> [!TOGGLE] S\n\n<b>x</b>\n\n[toc]\n\n<!-- block:a1 -->\n[l](/x "T") ![i](/wiki/attachments/a)\n\n| h |\n| -: |\n| c |\n',
    );
    const html = editor.getHTML();

    expect(html).toContain('data-callout="tip"');
    expect(html).toContain('role="note"');
    expect(html).toContain("<details>");
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(
        editor.state.doc.child(0).nodeSize,
        "open",
        true,
      ),
    );
    expect(editor.getHTML()).toContain('<details open=""');
    expect(html).toContain("<pre data-raw-markdown");
    expect(html).toContain("<nav data-table-of-contents");
    expect(html).toContain('id="block-a1"');
    expect(html).toContain('title="T"');
    expect(html).toContain('src="/wiki/attachments/a"');
    expect(html).toContain("text-align: right");
  });
});

describe("block anchors", () => {
  it("keeps an anchor once when a change repeats it", () => {
    const editor = open("<!-- block:a1 -->\none\n\ntwo\n");
    const copy = editor.state.doc.child(0);

    editor.view.dispatch(
      editor.state.tr.insert(editor.state.doc.content.size, copy),
    );

    expect(markdownOf(editor)).toBe("<!-- block:a1 -->\none\n\ntwo\n\none\n");
  });

  it("reports whether anything had to be fixed", () => {
    const editor = open("plain\n\n<!-- block:b2 -->\nanchored\n");

    expect(removeDuplicateAnchors(editor.state.doc, editor.state.tr)).toBe(
      false,
    );
    editor.commands.setTextSelection(1);
    editor.view.dispatch(editor.state.tr.setMeta("selectionOnly", true));
    expect(markdownOf(editor)).toBe("plain\n\n<!-- block:b2 -->\nanchored\n");
  });
});

describe("editor keys", () => {
  it("moves and duplicates blocks and opens link, menu and assistant", () => {
    const onLink = vi.fn();
    const onContextMenu = vi.fn();
    const onTextAssistant = vi.fn();
    const editor = open("one\n\ntwo\n", {
      onContextMenu,
      onLink,
      onTextAssistant,
    });

    caretAt(editor, 7);
    expect(pressKey(editor, "ArrowUp", { mod: true, shift: true })).toBe(true);
    expect(markdownOf(editor)).toBe("two\n\none\n");
    expect(pressKey(editor, "ArrowDown", { mod: true, shift: true })).toBe(
      true,
    );
    expect(pressKey(editor, "d", { mod: true })).toBe(true);
    expect(markdownOf(editor)).toBe("one\n\ntwo\n\ntwo\n");
    expect(pressKey(editor, "k", { mod: true })).toBe(true);
    expect(pressKey(editor, "j", { mod: true })).toBe(true);
    expect(pressKey(editor, "F10", { shift: true })).toBe(true);
    expect(pressKey(editor, "ContextMenu")).toBe(true);
    expect([
      onLink.mock.calls.length,
      onTextAssistant.mock.calls.length,
      onContextMenu.mock.calls.length,
    ]).toEqual([1, 1, 2]);
  });

  it("changes nothing when reading or without a selected block", () => {
    const onLink = vi.fn();
    const editor = open("one\n", { onLink });

    editor.setEditable(false);
    expect(pressKey(editor, "k", { mod: true })).toBe(false);
    expect(pressKey(editor, "d", { mod: true })).toBe(false);
    expect(pressKey(editor, "ArrowUp", { mod: true, shift: true })).toBe(false);
    expect(pressKey(editor, "ArrowDown", { mod: true, shift: true })).toBe(
      false,
    );
    expect(onLink).not.toHaveBeenCalled();
    expect(editor.commands.keyboardShortcut("Mod-k")).toBe(true);
    expect(editor.commands.keyboardShortcut("Mod-d")).toBe(true);
    expect(editor.commands.keyboardShortcut("Mod-Shift-ArrowUp")).toBe(true);
    expect(onLink).not.toHaveBeenCalled();
    expect(markdownOf(editor)).toBe("one\n");
  });

  it("moves nothing when the caret is behind the last block", () => {
    const editor = open("one\n\n---\n");

    editor.view.dispatch(
      editor.state.tr.setSelection(
        new GapCursor(editor.state.doc.resolve(editor.state.doc.content.size)),
      ),
    );
    expect(pressKey(editor, "ArrowUp", { mod: true, shift: true })).toBe(false);
    expect(pressKey(editor, "d", { mod: true })).toBe(false);
    expect(markdownOf(editor)).toBe("one\n\n---\n");
  });

  it("does nothing more than claiming the keys without callbacks", () => {
    const editor = new Editor({
      content: "<p>one</p>",
      element: document.body.appendChild(document.createElement("div")),
      extensions: [
        ...createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS),
        EditorKeymap,
      ],
    });

    editors.push(editor);
    expect(pressKey(editor, "k", { mod: true })).toBe(true);
    expect(pressKey(editor, "j", { mod: true })).toBe(true);
    expect(pressKey(editor, "F10", { shift: true })).toBe(true);
  });

  it("separates markdown shortcuts from the typing before them in the undo history", () => {
    const editor = open("\n");

    typeText(editor, "##");
    typeText(editor, " ");
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(undoDepth(editor.state)).toBe(2);
    editor.commands.undo();
    expect(markdownOf(editor)).toBe("\\##\n");
    expect(separateShortcutStep(editor.state.tr, editor.state)).toBe(true);
  });
});

describe("markdown links while typing", () => {
  it("turns [text](address) into a link and leaves refused addresses as text", () => {
    const editor = open("\n");

    typeText(editor, "see [docs](https://example.com)");
    expect(markdownOf(editor)).toBe("see [docs](https://example.com)\n");
    expect(editor.state.doc.firstChild?.lastChild?.marks[0]?.type.name).toBe(
      "link",
    );

    const refused = open("\n");

    typeText(refused, "[x](javascript:alert)");
    expect(refused.state.doc.firstChild?.textContent).toBe(
      "[x](javascript:alert)",
    );
  });
});
