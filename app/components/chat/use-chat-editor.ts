import { useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

import { createSchemaExtensions } from "@/app/components/editor/editor-extensions";
import { handleEditorPaste } from "@/app/components/editor/use-block-editor";
import {
  parseMarkdownSlice,
  readMarkdown,
  serializeMarkdown,
  serializeMarkdownFragment,
} from "@/app/lib/editor/editor-markdown";

import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";

/** The input field shows no images and uploads nothing; attachments use "+". */
const CHAT_FEATURES: BlockEditorFeatures = { isDisplayableImage: () => false };

interface ChatEditorOptions {
  /** Accessible name of the input field. */
  readonly label: string;
  readonly placeholder: string;
  /** Sends the current text; Enter outside code blocks or Mod+Enter. */
  readonly onSubmit: () => void;
}

/** The input field of the chat with its Markdown text. */
export interface ChatEditor {
  readonly editor: Editor | null;
  readonly markdown: string;
  /** Replaces the text, for example with a message that could not be sent. */
  setMarkdown(markdown: string): void;
}

function isInCode(view: EditorView): boolean {
  return view.state.selection.$from.parent.type.spec.code === true;
}

/**
 * A reduced fork of the block editor for chat messages (T6.12.10).
 *
 * @remarks
 * It shares the schema and the Markdown conversion of the text editor, so
 * Markdown shortcuts, code blocks and inline code work as in the wiki. Slash
 * menu, block handles, references and uploads are left out: `/` starts a chat
 * command instead. Enter sends; Shift+Enter breaks the line and Enter stays a
 * line break inside a code block.
 */
export function useChatEditor(options: ChatEditorOptions): ChatEditor {
  const optionsRef = useRef(options);
  const [markdown, setMarkdownState] = useState("");
  const [extensions] = useState(() =>
    createSchemaExtensions({
      checkboxLabel: () => "",
      isDisplayableImage: CHAT_FEATURES.isDisplayableImage,
      placeholder: options.placeholder,
    }),
  );

  useEffect(() => {
    optionsRef.current = options;
  });

  const editor = useEditor(
    {
      editorProps: {
        attributes: {
          "aria-label": options.label,
          "aria-multiline": "true",
          class: "pages-selectable",
          role: "textbox",
        },
        clipboardTextParser: (text, context) =>
          parseMarkdownSlice(text, context.doc.type.schema),
        clipboardTextSerializer: (slice) =>
          serializeMarkdownFragment(slice.content),
        handleKeyDown: (view, event) => {
          if (event.key !== "Enter" || event.isComposing) return false;
          const isSend =
            event.ctrlKey ||
            event.metaKey ||
            (!event.shiftKey && !isInCode(view));
          if (isSend) optionsRef.current.onSubmit();
          return isSend;
        },
        handlePaste: (view, event) =>
          handleEditorPaste(view, event, {
            features: CHAT_FEATURES,
            isPlain: false,
          }),
      },
      enablePasteRules: false,
      extensions,
      immediatelyRender: false,
      // The message is stored and reaches Pica exactly as typed, without
      // escaped brackets; the history renders it as Markdown.
      onUpdate: ({ editor: changed }) =>
        setMarkdownState(
          serializeMarkdown(changed.state.doc, null, "typed").trim(),
        ),
    },
    [],
  );

  function setMarkdown(next: string): void {
    if (!editor) return;
    editor.commands.setContent(readMarkdown(next, editor.schema).content);
    setMarkdownState(next.trim());
  }

  return { editor, markdown, setMarkdown };
}
