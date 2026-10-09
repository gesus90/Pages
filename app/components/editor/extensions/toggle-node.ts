import { mergeAttributes, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { ToggleView } from "@/app/components/editor/extensions/toggle-view";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import type { Editor } from "@tiptap/core";

/** The always visible first line of a toggle: plain text, no marks. */
export const ToggleSummaryNode = Node.create({
  content: "text*",
  defining: true,
  marks: "",
  name: EDITOR_NODE.toggleSummary,
  parseHTML() {
    return [{ tag: "summary" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["summary", HTMLAttributes, 0];
  },
});

/**
 * Starts the content of a toggle: Enter in the summary opens the toggle and
 * puts the caret into a new first block below the summary.
 *
 * @param editor - The editor.
 * @returns Whether the key was handled.
 */
export function enterToggleBody(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;

  if (!empty || $from.parent.type.name !== EDITOR_NODE.toggleSummary) {
    return false;
  }

  const afterSummary = $from.after();
  const transaction = state.tr
    .setNodeAttribute($from.before(-1), "open", true)
    .insert(afterSummary, state.schema.node(EDITOR_NODE.paragraph));

  transaction.setSelection(
    TextSelection.create(transaction.doc, afterSummary + 1),
  );
  editor.view.dispatch(transaction.scrollIntoView());

  return true;
}

/**
 * Turns a toggle back into plain blocks when Backspace is pressed at the
 * start of its summary: the summary becomes a paragraph, the content stays.
 *
 * @param editor - The editor.
 * @returns Whether the key was handled.
 */
export function unwrapToggle(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;

  if (
    !empty ||
    $from.parent.type.name !== EDITOR_NODE.toggleSummary ||
    $from.parentOffset !== 0
  ) {
    return false;
  }

  const toggle = $from.node(-1);
  const position = $from.before(-1);
  const blocks = [
    state.schema.node(EDITOR_NODE.paragraph, null, $from.parent.content),
  ];

  toggle.forEach((child, _, index) => {
    if (index > 0) {
      blocks.push(child);
    }
  });

  const transaction = state.tr.replaceWith(
    position,
    position + toggle.nodeSize,
    blocks,
  );

  transaction.setSelection(TextSelection.create(transaction.doc, position + 1));
  editor.view.dispatch(transaction.scrollIntoView());

  return true;
}

/**
 * A collapsible block (`> [!TOGGLE] Title`): a summary line and blocks that
 * show only while it is open. Whether it is open is not saved.
 */
export const ToggleNode = Node.create({
  addAttributes() {
    return {
      open: {
        default: true,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => element.hasAttribute("open"),
        rendered: false,
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => unwrapToggle(editor),
      Enter: ({ editor }) => enterToggleBody(editor),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
  content: `${EDITOR_NODE.toggleSummary} block*`,
  defining: true,
  group: "block",
  name: EDITOR_NODE.toggle,
  parseHTML() {
    return [{ tag: "details" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "details",
      mergeAttributes(
        HTMLAttributes,
        node.attrs.open === true ? { open: "" } : {},
      ),
      0,
    ];
  },
});
