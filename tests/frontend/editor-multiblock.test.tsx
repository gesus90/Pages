// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";

import { duplicateBlock, moveBlock } from "@/app/lib/editor/editor-commands";
import { serializeMarkdown } from "@/app/lib/editor/editor-markdown";

import { installEditorGeometry, renderBlockEditor } from "../helpers/editor";

import type { Editor } from "@tiptap/core";

const DOCUMENT =
  "# Heading\n\n- **First**\n- [Link](https://example.test)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst count = 1;\n```\n\n![Diagram](/aufgaben/attachments/image)\n";

interface EditorElement extends HTMLElement {
  readonly editor: Editor;
}

beforeAll(installEditorGeometry);

async function ready(markdown: string): Promise<Editor> {
  const rendered = renderBlockEditor(markdown);
  await waitFor(() => expect(rendered.onReady).toHaveBeenCalled());
  return (rendered.handle().element as EditorElement).editor;
}

it("copies several rich blocks through the actual editor clipboard serializer and pastes them without structure loss", async () => {
  const source = await ready(DOCUMENT);
  const destination = await ready("");
  const before = serializeMarkdown(source.state.doc, null);
  act(() => source.commands.selectAll());
  const clipboard = source.view.serializeForClipboard(
    source.state.selection.content(),
  );
  expect(clipboard.dom.querySelector("table")).not.toBeNull();
  expect(clipboard.dom.querySelector("strong")).not.toBeNull();
  expect(clipboard.dom.querySelector("pre")).not.toBeNull();
  expect(clipboard.dom.querySelector("img")).not.toBeNull();
  act(() => destination.view.pasteHTML(clipboard.dom.innerHTML));
  expect(serializeMarkdown(destination.state.doc, null)).toBe(before);
  expect(serializeMarkdown(source.state.doc, null)).toBe(before);
  act(() => destination.commands.undo());
  expect(serializeMarkdown(destination.state.doc, null)).toBe("");
  act(() => destination.commands.redo());
  expect(serializeMarkdown(destination.state.doc, null)).toBe(before);
});

it("duplicates and moves rich blocks while retaining every other block and separate undo steps", async () => {
  const editor = await ready(DOCUMENT);
  const before = serializeMarkdown(editor.state.doc, null);
  let tablePosition = 0;
  editor.state.doc.forEach((node, position) => {
    if (node.type.name === "table") tablePosition = position;
  });
  act(() => duplicateBlock(editor, tablePosition));
  const duplicated = serializeMarkdown(editor.state.doc, null);
  expect(
    editor.state.doc.content.content.filter(
      (node) => node.type.name === "table",
    ),
  ).toHaveLength(2);
  act(() => moveBlock(editor, tablePosition, "up"));
  expect(editor.state.doc.child(1).type.name).toBe("table");
  expect(serializeMarkdown(editor.state.doc, null)).toContain(
    "const count = 1;",
  );
  act(() => editor.commands.undo());
  expect(serializeMarkdown(editor.state.doc, null)).toBe(duplicated);
  act(() => editor.commands.undo());
  expect(serializeMarkdown(editor.state.doc, null)).toBe(before);
});
