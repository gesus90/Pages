import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { isCalloutKind } from "@/app/components/markdown/callout-style";
import { CalloutView } from "@/app/components/editor/extensions/callout-view";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

/**
 * A highlighted note block (`> [!NOTE]` and the other kinds of the wiki
 * renderer) that holds further blocks.
 */
export const CalloutNode = Node.create({
  addAttributes() {
    return {
      kind: {
        default: "note",
        parseHTML: (element: HTMLElement) => {
          const kind = element.getAttribute("data-callout");

          return isCalloutKind(kind) ? kind : "note";
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-callout": attributes.kind,
        }),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
  content: "block+",
  defining: true,
  group: "block",
  name: EDITOR_NODE.callout,
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { role: "note" }), 0];
  },
});
