import { Editor } from "@tiptap/core";
import { afterEach, expect, it } from "vitest";

import {
  createSchemaExtensions,
  HEADLESS_SCHEMA_OPTIONS,
} from "@/app/components/editor/editor-extensions";
import {
  handleEditorPaste,
  isPlainPasteKey,
} from "@/app/components/editor/use-block-editor";

const editors: Editor[] = [];

function open(): Editor {
  const editor = new Editor({
    extensions: createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS),
    content: "<p></p>",
  });
  editors.push(editor);
  return editor;
}

function pasteEvent(text: string, html = ""): ClipboardEvent {
  const event = new Event("paste") as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (type: string) => (type === "text/html" ? html : text),
    },
  });
  return event;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

it("recognizes only the modified plain-paste shortcut", () => {
  expect(
    isPlainPasteKey(
      new KeyboardEvent("keydown", { key: "V", shiftKey: true, ctrlKey: true }),
    ),
  ).toBe(true);
  expect(
    isPlainPasteKey(
      new KeyboardEvent("keydown", { key: "v", shiftKey: true, metaKey: true }),
    ),
  ).toBe(true);
  expect(
    isPlainPasteKey(new KeyboardEvent("keydown", { key: "v", ctrlKey: true })),
  ).toBe(false);
  expect(
    isPlainPasteKey(
      new KeyboardEvent("keydown", { key: "x", shiftKey: true, ctrlKey: true }),
    ),
  ).toBe(false);
});

it("pastes markdown structurally and plain text without formatting", () => {
  const markdown = open();
  const plain = open();
  const features = { isDisplayableImage: () => false };
  expect(
    handleEditorPaste(markdown.view, pasteEvent("# Heading"), {
      features,
      isPlain: false,
    }),
  ).toBe(true);
  expect(markdown.getJSON().content?.[0]).toMatchObject({
    type: "heading",
    attrs: { level: 1 },
  });
  expect(
    handleEditorPaste(plain.view, pasteEvent("# Heading", "<h1>Heading</h1>"), {
      features,
      isPlain: true,
    }),
  ).toBe(true);
  expect(plain.getText()).toBe("# Heading");
  expect(plain.getJSON().content?.[0]?.type).toBe("paragraph");
});

it("leaves formatted HTML and empty clipboard content to the editor", () => {
  const editor = open();
  const features = { isDisplayableImage: () => false };
  expect(
    handleEditorPaste(editor.view, pasteEvent("Heading", "<h1>Heading</h1>"), {
      features,
      isPlain: false,
    }),
  ).toBe(false);
  expect(
    handleEditorPaste(editor.view, pasteEvent(""), {
      features,
      isPlain: false,
    }),
  ).toBe(false);
  expect(editor.getText()).toBe("");
});
