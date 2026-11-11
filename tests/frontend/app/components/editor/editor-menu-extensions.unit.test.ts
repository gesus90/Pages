import { Editor } from "@tiptap/core";
import { afterEach, expect, it, vi } from "vitest";

import { BLOCK_OPTIONS } from "@/app/components/editor/editor-block-catalog";
import {
  applyBlockOption,
  applyReference,
  insertCreatedPage,
  isBlockOptionAvailable,
} from "@/app/components/editor/editor-menu-extensions";
import {
  createSchemaExtensions,
  HEADLESS_SCHEMA_OPTIONS,
} from "@/app/components/editor/editor-extensions";

import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";
import type { BlockOption } from "@/app/components/editor/editor-block-catalog";

const editors: Editor[] = [];
const features: BlockEditorFeatures = { isDisplayableImage: () => false };

function open(text: string): Editor {
  const editor = new Editor({
    extensions: createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS),
    content: `<p>${text}</p>`,
  });
  editors.push(editor);
  return editor;
}

function option(key: BlockOption["key"]): BlockOption {
  const found = BLOCK_OPTIONS.find((entry) => entry.key === key);
  if (!found) throw new Error(`Missing option ${key}`);
  return found;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

it("offers uploads and pages only when their features are available", () => {
  expect(isBlockOptionAvailable(option("file"), features)).toBe(false);
  expect(isBlockOptionAvailable(option("page"), features)).toBe(false);
  expect(isBlockOptionAvailable(option("emoji"), features)).toBe(true);
  expect(
    isBlockOptionAvailable(option("file"), {
      ...features,
      uploadFiles: async () => [],
    }),
  ).toBe(true);
  expect(
    isBlockOptionAvailable(option("page"), {
      ...features,
      createPage: async () => null,
    }),
  ).toBe(true);
});

it("replaces triggers with plain or linked references", () => {
  const editor = open("@ada");
  applyReference(
    editor,
    { from: 1, to: 5 },
    {
      key: "ada",
      label: "Ada",
      hint: "person",
      insertion: { kind: "text", text: "Ada" },
    },
  );
  expect(editor.getText()).toBe("Ada");
  applyReference(
    editor,
    { from: 1, to: 4 },
    {
      key: "page",
      label: "Page",
      hint: "page",
      insertion: { kind: "link", text: "Page", href: "/page" },
    },
  );
  expect(editor.getText()).toBe("Page ");
  expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
    text: "Page",
    marks: [{ type: "link", attrs: { href: "/page" } }],
  });
});

it("removes slash commands before invoking the requested action or inserting a block", () => {
  const files = vi.fn();
  const emoji = vi.fn();
  const context = {
    features: () => features,
    requests: () => ({ files, emoji }),
  };
  const editor = open("/file");
  applyBlockOption(editor, { from: 1, to: 6 }, option("file"), context);
  expect(editor.getText()).toBe("");
  expect(files).toHaveBeenCalledOnce();
  editor.commands.insertContent("/emoji");
  applyBlockOption(editor, { from: 1, to: 7 }, option("emoji"), context);
  expect(emoji).toHaveBeenCalledWith(editor);
  editor.commands.insertContent("/heading");
  applyBlockOption(editor, { from: 1, to: 9 }, option("heading1"), context);
  expect(editor.getJSON().content?.[0]).toMatchObject({
    type: "heading",
    attrs: { level: 1 },
  });
});

it("inserts created pages and handles cancellation, destruction and failures", async () => {
  const editor = open("");
  expect(
    await insertCreatedPage(editor, {
      ...features,
      createPage: async () => ({ title: "Notes", href: "/notes", icon: "📘" }),
    }),
  ).toBe(true);
  expect(editor.getText()).toContain("📘 Notes");
  expect(
    editor
      .getJSON()
      .content?.some((node) =>
        node.content?.some((child) =>
          child.marks?.some((mark) => mark.attrs?.href === "/notes"),
        ),
      ),
  ).toBe(true);
  expect(await insertCreatedPage(editor, features)).toBe(false);
  expect(
    await insertCreatedPage(editor, {
      ...features,
      createPage: async () => null,
    }),
  ).toBe(false);
  const error = new Error("failed");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(
    await insertCreatedPage(editor, {
      ...features,
      createPage: async () => {
        throw error;
      },
    }),
  ).toBe(false);
  expect(log).toHaveBeenCalledWith(
    "The editor could not create the page.",
    error,
  );
  editor.destroy();
  expect(
    await insertCreatedPage(editor, {
      ...features,
      createPage: async () => ({ title: "Late", href: "/late", icon: null }),
    }),
  ).toBe(false);
});
