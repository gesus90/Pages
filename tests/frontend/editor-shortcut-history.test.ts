// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { serializeMarkdown } from "@/app/lib/editor/editor-markdown";

import {
  createTestEditor,
  installEditorGeometry,
  pressKey,
  typeText,
} from "../helpers/editor";

import type { Editor } from "@tiptap/core";

const editors: Editor[] = [];
beforeAll(installEditorGeometry);
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe("keyboard block transformations preserve separate undo steps", () => {
  it("leaves the dedicated chat shortcut alone when no application connected it", () => {
    const editor = createTestEditor("Paragraph\n");
    editors.push(editor);
    expect(pressKey(editor, "j", { mod: true, alt: true, shift: true })).toBe(
      false,
    );
  });

  it.each([1, 2, 3])(
    "restores a typed level %s heading with one undo after conversion to text",
    (level) => {
      const editor = createTestEditor("\n");
      editors.push(editor);
      typeText(editor, "#".repeat(level) + " Heading");
      const before = serializeMarkdown(editor.state.doc, null);
      expect(pressKey(editor, "0", { mod: true, alt: true })).toBe(true);
      expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
      pressKey(editor, "z", { mod: true });
      expect(serializeMarkdown(editor.state.doc, null)).toBe(before);
      pressKey(editor, "z", { mod: true, shift: true });
      expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    },
  );

  it.each([1, 2, 3])(
    "keeps typed text when undoing conversion to level %s heading",
    (level) => {
      const editor = createTestEditor("\n");
      editors.push(editor);
      typeText(editor, "Paragraph");
      expect(pressKey(editor, String(level), { mod: true, alt: true })).toBe(
        true,
      );
      expect(editor.state.doc.firstChild?.attrs.level).toBe(level);
      pressKey(editor, "z", { mod: true });
      expect(serializeMarkdown(editor.state.doc, null)).toBe("Paragraph\n");
    },
  );

  it("refuses all block transformation shortcuts in a read-only editor", () => {
    const editor = createTestEditor("Paragraph\n");
    editors.push(editor);
    editor.setEditable(false);
    for (const key of ["0", "1", "2", "3"]) {
      pressKey(editor, key, { mod: true, alt: true });
      expect(editor.commands.keyboardShortcut(`Mod-Alt-${key}`)).toBe(true);
    }
    expect(serializeMarkdown(editor.state.doc, null)).toBe("Paragraph\n");
  });
});
