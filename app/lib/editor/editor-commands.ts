import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

import {
  ANCHORABLE_NODES,
  EDITOR_NODE,
  readTextAttribute,
} from "@/app/lib/editor/editor-schema";

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";

/** Block types a block can be turned into. */
export const BLOCK_KINDS = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulletList",
  "orderedList",
  "taskList",
  "quote",
  "callout",
  "toggle",
  "codeBlock",
] as const;

/** A block type a block can be turned into. */
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** Blocks that can only be inserted, not turned into. */
export const INSERT_ONLY_KINDS = ["divider", "table", "contents"] as const;

/** Everything the slash menu can insert. */
export type InsertKind = BlockKind | (typeof INSERT_ONLY_KINDS)[number];

/** A top-level block of the document and where it starts. */
export interface TopLevelBlock {
  readonly node: ProseMirrorNode;
  /** Position right before the block. */
  readonly position: number;
  readonly index: number;
}

const ANCHOR_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Starts a new undo step, so that undo reverts exactly the next change and
 * not the typing before it.
 *
 * @param editor - The editor.
 */
export function startUndoStep(editor: Editor): void {
  editor.view.dispatch(closeHistory(editor.state.tr));
}

/**
 * Finds the top-level block at a position.
 *
 * @param doc - The document.
 * @param position - Any position inside or right before the block.
 * @returns The block, or `null` outside of the document.
 */
export function findTopLevelBlock(
  doc: ProseMirrorNode,
  position: number,
): TopLevelBlock | null {
  if (position < 0 || position >= doc.content.size) {
    return null;
  }

  const index = doc.resolve(position).index(0);
  const node = doc.child(index);
  let start = 0;

  for (let current = 0; current < index; current += 1) {
    start += doc.child(current).nodeSize;
  }

  return { index, node, position: start };
}

/**
 * Finds the top-level block that holds the selection.
 *
 * @param editor - The editor.
 * @returns The block of the selection head.
 */
export function findSelectedBlock(editor: Editor): TopLevelBlock | null {
  return findTopLevelBlock(editor.state.doc, editor.state.selection.from);
}

/**
 * Puts the selection into a block, so that commands apply to it: the caret
 * goes to the start of its text, or the whole block is selected when it has
 * no text to hold a caret.
 *
 * @param editor - The editor.
 * @param position - Position right before the block.
 */
export function selectBlock(editor: Editor, position: number): void {
  const { doc } = editor.state;
  const block = findTopLevelBlock(doc, position);

  if (!block) {
    return;
  }

  const { node } = block;

  const selection =
    node.isAtom || node.type.name === EDITOR_NODE.table
      ? NodeSelection.create(doc, block.position)
      : TextSelection.near(doc.resolve(block.position + 1));

  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

function wrapInToggle(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const block = $from.parent;

  if (!block.isTextblock || $from.depth === 0) {
    return false;
  }

  const start = $from.before();
  const text = block.textContent;
  const summary = state.schema.node(
    EDITOR_NODE.toggleSummary,
    null,
    text === "" ? undefined : state.schema.text(text),
  );
  const transaction = state.tr.replaceWith(
    start,
    $from.after(),
    state.schema.node(EDITOR_NODE.toggle, { open: true }, [summary]),
  );

  transaction.setSelection(
    TextSelection.create(transaction.doc, start + 2 + text.length),
  );
  editor.view.dispatch(transaction.scrollIntoView());

  return true;
}

/**
 * Turns the block of the selection into another type of block.
 *
 * @param editor - The editor.
 * @param kind - The new type.
 * @returns Whether the block changed.
 *
 * @remarks
 * The change is an undo step of its own. The block is first reduced to plain
 * paragraphs, so a list item becomes a heading and a quote becomes a list.
 */
export function turnBlockInto(editor: Editor, kind: BlockKind): boolean {
  startUndoStep(editor);

  const chain = editor.chain().focus().clearNodes();

  switch (kind) {
    case "paragraph":
      // Reducing the block already leaves plain paragraphs.
      return chain.run();
    case "heading1":
      return chain.setHeading({ level: 1 }).run();
    case "heading2":
      return chain.setHeading({ level: 2 }).run();
    case "heading3":
      return chain.setHeading({ level: 3 }).run();
    case "bulletList":
      return chain.toggleBulletList().run();
    case "orderedList":
      return chain.toggleOrderedList().run();
    case "taskList":
      return chain.toggleTaskList().run();
    case "quote":
      return chain.setBlockquote().run();
    case "callout":
      return chain.wrapIn(EDITOR_NODE.callout, { kind: "note" }).run();
    case "codeBlock":
      return chain.setCodeBlock().run();
    case "toggle":
      return chain.run() && wrapInToggle(editor);
  }
}

/**
 * Inserts a block at the selection, as the slash menu does.
 *
 * @param editor - The editor.
 * @param kind - What to insert.
 * @returns Whether anything was inserted.
 *
 * @remarks
 * Block types are applied to the current block when it is empty and to a
 * new block below it otherwise.
 */
export function insertBlock(editor: Editor, kind: InsertKind): boolean {
  if (kind === "divider") {
    startUndoStep(editor);

    return editor.chain().focus().setHorizontalRule().run();
  }

  if (kind === "table") {
    startUndoStep(editor);

    return editor
      .chain()
      .focus()
      .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
      .run();
  }

  if (kind === "contents") {
    startUndoStep(editor);

    return editor
      .chain()
      .focus()
      .insertContent([
        { type: EDITOR_NODE.tableOfContents },
        { type: EDITOR_NODE.paragraph },
      ])
      .run();
  }

  return turnBlockInto(editor, kind);
}

function withoutAnchor(node: ProseMirrorNode): ProseMirrorNode {
  return readTextAttribute(node.attrs, "blockId") === null
    ? node
    : node.type.create(
        { ...node.attrs, blockId: null },
        node.content,
        node.marks,
      );
}

/**
 * Copies a top-level block and puts the copy right below it.
 *
 * @param editor - The editor.
 * @param position - Position right before the block.
 * @returns Whether the block was copied.
 */
export function duplicateBlock(editor: Editor, position: number): boolean {
  const block = findTopLevelBlock(editor.state.doc, position);

  if (!block) {
    return false;
  }

  startUndoStep(editor);

  const after = block.position + block.node.nodeSize;

  editor.view.dispatch(
    editor.state.tr.insert(after, withoutAnchor(block.node)).scrollIntoView(),
  );
  selectBlock(editor, after);

  return true;
}

/**
 * Deletes a top-level block.
 *
 * @param editor - The editor.
 * @param position - Position right before the block.
 * @returns Whether the block was deleted.
 */
export function deleteBlock(editor: Editor, position: number): boolean {
  const block = findTopLevelBlock(editor.state.doc, position);

  if (!block) {
    return false;
  }

  startUndoStep(editor);

  // Deleting the last block leaves an empty paragraph: ProseMirror fills
  // the document, which needs at least one block.
  const transaction = editor.state.tr.delete(
    block.position,
    block.position + block.node.nodeSize,
  );

  transaction.setSelection(
    TextSelection.near(
      transaction.doc.resolve(
        Math.min(block.position, transaction.doc.content.size),
      ),
    ),
  );
  editor.view.dispatch(transaction.scrollIntoView());

  return true;
}

/**
 * Moves a top-level block one place up or down; the selection moves along.
 *
 * @param editor - The editor.
 * @param position - Position right before the block.
 * @param direction - Where to move the block.
 * @returns Whether the block moved.
 */
export function moveBlock(
  editor: Editor,
  position: number,
  direction: "up" | "down",
): boolean {
  const { doc, selection } = editor.state;
  const block = findTopLevelBlock(doc, position);
  const neighbour = block
    ? doc.maybeChild(block.index + (direction === "up" ? -1 : 1))
    : null;

  if (!block || !neighbour) {
    return false;
  }

  startUndoStep(editor);

  const end = block.position + block.node.nodeSize;
  const offset = Math.max(
    0,
    Math.min(selection.from - block.position, block.node.nodeSize),
  );
  const transaction = editor.state.tr.delete(block.position, end);
  const target =
    direction === "up"
      ? block.position - neighbour.nodeSize
      : block.position + neighbour.nodeSize;

  transaction.insert(target, block.node);
  transaction.setSelection(
    selection instanceof NodeSelection
      ? NodeSelection.create(transaction.doc, target)
      : TextSelection.near(transaction.doc.resolve(target + offset)),
  );
  editor.view.dispatch(transaction.scrollIntoView());

  return true;
}

function createAnchorId(): string {
  const values = crypto.getRandomValues(new Uint8Array(8));

  return Array.from(
    values,
    (value) => ANCHOR_ALPHABET[value % ANCHOR_ALPHABET.length],
  ).join("");
}

/**
 * Gives a top-level block an anchor, so that a link can point to it.
 *
 * @param editor - The editor.
 * @param position - Position right before the block.
 * @returns The anchor of the block, or `null` when it cannot have one.
 *
 * @remarks
 * A block keeps the anchor it already has. Adding one is no undo step: it is
 * invisible and must stay while the link is in use.
 */
export function anchorBlock(editor: Editor, position: number): string | null {
  const block = findTopLevelBlock(editor.state.doc, position);

  if (!block || !ANCHORABLE_NODES.includes(block.node.type.name)) {
    return null;
  }

  const existing = readTextAttribute(block.node.attrs, "blockId");

  if (existing !== null) {
    return existing;
  }

  const id = createAnchorId();

  editor.view.dispatch(
    editor.state.tr
      .setNodeAttribute(block.position, "blockId", id)
      .setMeta("addToHistory", false),
  );

  return id;
}

/**
 * Builds a slice of plain paragraphs from text, without reading markdown.
 *
 * @param text - Pasted text.
 * @param schema - Schema of the editor.
 * @returns One paragraph per line; a single line joins the paragraph it
 * lands in.
 */
export function createPlainTextSlice(text: string, schema: Schema): Slice {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      schema.node(
        EDITOR_NODE.paragraph,
        null,
        line === "" ? undefined : schema.text(line),
      ),
    );

  return new Slice(Fragment.fromArray(paragraphs), 1, 1);
}
