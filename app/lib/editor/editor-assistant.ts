import { closeHistory } from "@tiptap/pm/history";

import {
  parseMarkdownSlice,
  serializeMarkdown,
  serializeMarkdownFragment,
} from "./editor-markdown";

import type { Editor } from "@tiptap/core";
import type { AssistantEditorTarget } from "@/app/components/editor/block-editor-types";
import type { MarkdownBaseline } from "./editor-markdown";

/** Captures positions and Markdown before a menu or chat moves browser focus. */
export function captureAssistantTarget(
  editor: Editor,
  baseline: MarkdownBaseline | null,
): AssistantEditorTarget {
  const { from, to } = editor.state.selection;
  return {
    from,
    to,
    selectionMarkdown: serializeMarkdownFragment(
      editor.state.doc.slice(from, to).content,
    ),
    documentMarkdown: serializeMarkdown(editor.state.doc, baseline),
  };
}

/** Rejects changed drafts; accepted output is a single isolated history transaction. */
export function applyAssistantText(
  editor: Editor,
  baseline: MarkdownBaseline | null,
  change: {
    readonly target: AssistantEditorTarget;
    readonly text: string;
    readonly scope: "none" | "selection" | "document";
    readonly kind: "replace" | "insert";
    readonly maximumLength: number;
    readonly lengthUnit?: "codePoint" | "codeUnit";
  },
): boolean {
  if (
    !editor.isEditable ||
    serializeMarkdown(editor.state.doc, baseline) !==
      change.target.documentMarkdown
  )
    return false;
  const slice = parseMarkdownSlice(change.text, editor.schema);
  const from =
    change.scope === "document" && change.kind === "replace"
      ? 0
      : change.target.from;
  let to = change.target.to;
  if (change.kind === "insert") to = from;
  else if (change.scope === "document") to = editor.state.doc.content.size;
  const transaction = editor.state.tr.replaceRange(from, to, slice);
  const markdown = serializeMarkdown(transaction.doc, baseline);
  const length =
    change.lengthUnit === "codeUnit" ? markdown.length : [...markdown].length;
  if (length > change.maximumLength) return false;
  editor.view.dispatch(closeHistory(transaction).scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.view.focus();
  return true;
}
