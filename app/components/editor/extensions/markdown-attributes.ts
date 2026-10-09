import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import {
  ANCHORABLE_NODES,
  EDITOR_MARK,
  EDITOR_NODE,
  LIST_NODES,
  readTextAttribute,
} from "@/app/lib/editor/editor-schema";

import type { Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const ALIGNMENTS = ["left", "center", "right"] as const;

function readAlignment(element: HTMLElement): string | null {
  const align = element.style.textAlign;

  return ALIGNMENTS.find((known) => known === align) ?? null;
}

/**
 * Drops repeated block anchors, which a paste or a duplicated block can
 * bring in; the first block keeps the anchor, the others lose it.
 *
 * @param doc - The document after a change.
 * @param transaction - Transaction to add the fixes to.
 * @returns Whether anything was fixed.
 */
export function removeDuplicateAnchors(
  doc: ProseMirrorNode,
  transaction: Transaction,
): boolean {
  const seen = new Set<string>();
  let isChanged = false;

  doc.forEach((block, offset) => {
    const anchor = readTextAttribute(block.attrs, "blockId");

    if (anchor === null) {
      return;
    }

    if (seen.has(anchor)) {
      transaction.setNodeAttribute(offset, "blockId", null);
      isChanged = true;
    }

    seen.add(anchor);
  });

  return isChanged;
}

/**
 * Attributes that only exist to write markdown back faithfully: block
 * anchors, loose lists, the info string of code blocks, link titles and the
 * alignment of table columns.
 */
export const MarkdownAttributes = Extension.create({
  addGlobalAttributes() {
    return [
      {
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-block-id"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.blockId === "string"
                ? {
                    "data-block-id": attributes.blockId,
                    id: `block-${attributes.blockId}`,
                  }
                : {},
          },
        },
        types: [...ANCHORABLE_NODES],
      },
      {
        attributes: { spread: { default: false, rendered: false } },
        types: [...LIST_NODES],
      },
      {
        attributes: { meta: { default: null, rendered: false } },
        types: [EDITOR_NODE.codeBlock],
      },
      {
        attributes: {
          title: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("title"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.title === "string"
                ? { title: attributes.title }
                : {},
          },
        },
        types: [EDITOR_MARK.link],
      },
      {
        attributes: {
          align: {
            default: null,
            parseHTML: readAlignment,
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.align === "string"
                ? { style: `text-align: ${attributes.align}` }
                : {},
          },
        },
        types: [EDITOR_NODE.tableCell, EDITOR_NODE.tableHeader],
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _, state) => {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }

          const transaction = state.tr;

          return removeDuplicateAnchors(state.doc, transaction)
            ? transaction
            : null;
        },
        key: new PluginKey("markdownAnchors"),
      }),
    ];
  },
  name: "markdownAttributes",
});
