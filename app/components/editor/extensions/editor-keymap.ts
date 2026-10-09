import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import {
  duplicateBlock,
  findSelectedBlock,
  moveBlock,
  turnBlockInto,
} from "@/app/lib/editor/editor-commands";

import type { Editor } from "@tiptap/core";
import type { Transaction, EditorState } from "@tiptap/pm/state";
import type { BlockKind } from "@/app/lib/editor/editor-commands";

/** What the editor keys open in the surrounding interface. */
export interface EditorKeymapOptions {
  /** Opens the link dialog (`Mod+K`). */
  readonly onLink: (editor: Editor) => void;
  /** Opens the context menu at the caret (`Shift+F10`, menu key). */
  readonly onContextMenu: (editor: Editor) => void;
  /** Opens the text assistant actions at the caret (`Mod+J`). */
  readonly onTextAssistant: (editor: Editor) => void;
  /** Opens the sidebar directly without choosing an AI action. */
  readonly onAssistantChat?: (editor: Editor) => void;
}

/**
 * Starts a new undo step before a markdown shortcut changes a block, so undo
 * restores the typed characters instead of removing the typing as well.
 *
 * @param transaction - A transaction about to be applied.
 * @param state - The state it applies to.
 * @returns Always `true`; the transaction is only marked.
 */
export function separateShortcutStep(
  transaction: Transaction,
  state: EditorState,
): boolean {
  // Tiptap adds one input rule plugin per extension and marks the
  // transaction of a rule with that plugin.
  if (
    state.plugins.some(
      (plugin) =>
        plugin.spec.isInputRules === true &&
        transaction.getMeta(plugin) !== undefined,
    )
  ) {
    closeHistory(transaction);
  }

  return true;
}

function moveSelectedBlock(editor: Editor, direction: "up" | "down"): boolean {
  const block = findSelectedBlock(editor);

  return block ? moveBlock(editor, block.position, direction) : false;
}

function duplicateSelectedBlock(editor: Editor): boolean {
  const block = findSelectedBlock(editor);

  return block ? duplicateBlock(editor, block.position) : false;
}

function transformSelectedBlock(editor: Editor, kind: BlockKind): boolean {
  return editor.isEditable ? turnBlockInto(editor, kind) : true;
}

/** Keys of the block editor beyond the ones of the single extensions. */
export const EditorKeymap = Extension.create<EditorKeymapOptions>({
  // Paragraph's built-in keymap has priority 1000; block commands must
  // take precedence so keyboard and menu changes share undo boundaries.
  priority: 1100,
  addKeyboardShortcuts() {
    const { onContextMenu, onLink, onTextAssistant, onAssistantChat } =
      this.options;

    return {
      ContextMenu: ({ editor }) => {
        onContextMenu(editor);

        return true;
      },
      "Mod-d": ({ editor }) =>
        editor.isEditable && duplicateSelectedBlock(editor),
      "Mod-Alt-0": ({ editor }) => transformSelectedBlock(editor, "paragraph"),
      "Mod-Alt-1": ({ editor }) => transformSelectedBlock(editor, "heading1"),
      "Mod-Alt-2": ({ editor }) => transformSelectedBlock(editor, "heading2"),
      "Mod-Alt-3": ({ editor }) => transformSelectedBlock(editor, "heading3"),
      "Mod-Alt-Shift-j": ({ editor }) => {
        onAssistantChat?.(editor);
        return onAssistantChat !== undefined;
      },
      "Mod-j": ({ editor }) => {
        onTextAssistant(editor);

        return true;
      },
      "Mod-k": ({ editor }) => {
        if (editor.isEditable) {
          onLink(editor);
        }

        return editor.isEditable;
      },
      "Mod-Shift-ArrowDown": ({ editor }) =>
        editor.isEditable && moveSelectedBlock(editor, "down"),
      "Mod-Shift-ArrowUp": ({ editor }) =>
        editor.isEditable && moveSelectedBlock(editor, "up"),
      "Shift-F10": ({ editor }) => {
        onContextMenu(editor);

        return true;
      },
    };
  },
  addOptions() {
    return {
      onContextMenu: () => {},
      onLink: () => {},
      onTextAssistant: () => {},
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: separateShortcutStep,
        key: new PluginKey("shortcutUndoSteps"),
      }),
    ];
  },
  name: "editorKeymap",
});
