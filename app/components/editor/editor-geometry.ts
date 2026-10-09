import type { Editor } from "@tiptap/core";

/**
 * The rectangle of the caret on screen, where menus for the keyboard open.
 *
 * @param editor - The editor.
 * @returns A thin rectangle at the selection head.
 */
export function caretRect(editor: Editor): DOMRect {
  const coords = editor.view.coordsAtPos(editor.state.selection.head);

  return new DOMRect(coords.left, coords.top, 1, coords.bottom - coords.top);
}

/**
 * Gives the focus back to the editor after a menu or dialog closed, unless
 * the editor is gone meanwhile.
 *
 * @param editor - The editor.
 */
export function returnFocus(editor: Editor): void {
  if (!editor.isDestroyed) {
    editor.commands.focus();
  }
}
