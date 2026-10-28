import { getSchema } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";

import {
  createSchemaExtensions,
  HEADLESS_SCHEMA_OPTIONS,
} from "@/app/components/editor/editor-extensions";
import { readMarkdown } from "@/app/lib/editor/editor-markdown";

import type { Extensions } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** The extensions of the block editor, without anything that renders. */
export function createEditorExtensions(): Extensions {
  return createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS);
}

/** The schema of the block editor. */
export const EDITOR_TEST_SCHEMA = getSchema(createEditorExtensions());

/**
 * A schema with nodes and marks the block editor does not have, for content
 * that other editors built on the same serializer may hold.
 */
export const FOREIGN_SCHEMA = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    rawMarkdown: { content: "text*", group: "block", marks: "" },
    text: { group: "inline" },
    mention: {
      atom: true,
      group: "inline",
      inline: true,
      leafText: (): string => "@ada",
    },
    spacer: { atom: true, group: "inline", inline: true },
  },
  marks: { underline: {} },
});

/**
 * Builds a node of the block editor schema from its JSON form.
 *
 * @param json - The node as the editor stores it.
 */
export function editorNode(
  json: Readonly<Record<string, unknown>>,
): ProseMirrorNode {
  return EDITOR_TEST_SCHEMA.nodeFromJSON(json);
}

/**
 * Reads markdown into a document of the block editor.
 *
 * @param markdown - Markdown text.
 */
export function editorDocument(markdown: string): ProseMirrorNode {
  return EDITOR_TEST_SCHEMA.nodeFromJSON(
    readMarkdown(markdown, EDITOR_TEST_SCHEMA).content,
  );
}

/**
 * Lists the top-level blocks of a document.
 *
 * @param doc - The document.
 */
export function topBlocks(doc: ProseMirrorNode): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = [];
  doc.forEach((block) => blocks.push(block));
  return blocks;
}
