import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { RawMarkdownView } from "@/app/components/editor/extensions/raw-markdown-view";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import type { Editor } from "@tiptap/core";

/**
 * Inserts a line break inside a source block, where Enter must not leave it.
 *
 * @param editor - The editor.
 * @returns Whether the caret was in a source block.
 */
export function breakRawMarkdownLine(editor: Editor): boolean {
  if (
    editor.state.selection.$from.parent.type.name !== EDITOR_NODE.rawMarkdown
  ) {
    return false;
  }

  return editor.commands.insertContent("\n");
}

/**
 * Markdown the editor cannot show as blocks, kept as editable source text so
 * that nothing of it is lost (raw HTML, reference links, footnotes …).
 */
export const RawMarkdownNode = Node.create({
  addKeyboardShortcuts() {
    return { Enter: ({ editor }) => breakRawMarkdownLine(editor) };
  },
  addNodeView() {
    return ReactNodeViewRenderer(RawMarkdownView);
  },
  code: true,
  content: "text*",
  defining: true,
  group: "block",
  marks: "",
  name: EDITOR_NODE.rawMarkdown,
  parseHTML() {
    // Ahead of the code block rule, which also reads `pre` elements.
    return [
      {
        preserveWhitespace: "full",
        priority: 60,
        tag: "pre[data-raw-markdown]",
      },
    ];
  },
  renderHTML() {
    return ["pre", { "data-raw-markdown": "" }, ["code", 0]];
  },
});
