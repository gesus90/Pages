import { createPlainTextSlice } from "@/app/lib/editor/editor-commands";
import { parseMarkdownSlice } from "@/app/lib/editor/editor-markdown";

import type { Editor } from "@tiptap/core";

/** How a clipboard action of the menu ended. */
export type ClipboardOutcome = "done" | "denied" | "unavailable";

/**
 * Copies or cuts the selection of the editor, exactly as the keyboard
 * shortcut does: the editor fills the clipboard with HTML and markdown.
 *
 * @param editor - The editor.
 * @param action - `copy` or `cut`.
 * @returns Whether the browser carried out the action.
 */
export function runClipboardCommand(
  editor: Editor,
  action: "copy" | "cut",
): boolean {
  editor.view.focus();

  // The clipboard API cannot write the editor's own formats; the command
  // makes the browser fire the same copy event as the shortcut.
  return document.execCommand(action);
}

async function readRichClipboard(
  clipboard: Clipboard,
): Promise<{ readonly html: string | null; readonly text: string }> {
  if (typeof clipboard.read !== "function") {
    return { html: null, text: await clipboard.readText() };
  }

  const [item] = await clipboard.read();

  if (item?.types.includes("text/html")) {
    return { html: await (await item.getType("text/html")).text(), text: "" };
  }

  return {
    html: null,
    text: item?.types.includes("text/plain")
      ? await (await item.getType("text/plain")).text()
      : "",
  };
}

/**
 * Pastes from the clipboard into the editor, for the menu entries.
 *
 * @param editor - The editor.
 * @param isPlain - Whether formatting is dropped ("paste as plain text").
 * @returns `done` after pasting; `unavailable` without the clipboard API
 * (for example outside a secure context) and `denied` when the browser
 * refused, so the menu can point to the keyboard shortcut instead.
 */
export async function pasteFromClipboard(
  editor: Editor,
  isPlain: boolean,
): Promise<ClipboardOutcome> {
  const clipboard: Clipboard | undefined = navigator.clipboard;

  if (clipboard === undefined || typeof clipboard.readText !== "function") {
    return "unavailable";
  }

  try {
    const { schema } = editor.state;

    if (isPlain) {
      const text = await clipboard.readText();

      editor.view.dispatch(
        editor.state.tr.replaceSelection(createPlainTextSlice(text, schema)),
      );

      return "done";
    }

    const { html, text } = await readRichClipboard(clipboard);

    if (html !== null) {
      editor.view.pasteHTML(html);
    } else {
      editor.view.dispatch(
        editor.state.tr.replaceSelection(parseMarkdownSlice(text, schema)),
      );
    }

    return "done";
  } catch (error: unknown) {
    console.warn("The browser refused to read the clipboard.", error);

    return "denied";
  }
}

/**
 * Puts text on the clipboard, such as the link to a block.
 *
 * @param text - The text.
 * @returns Whether the text is on the clipboard.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);

    return true;
  } catch (error: unknown) {
    console.warn("The browser refused to write the clipboard.", error);

    return false;
  }
}
