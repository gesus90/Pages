import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { ContentsView } from "@/app/components/editor/extensions/contents-view";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

/** The table of contents (`[toc]`): lists the headings of the document. */
export const ContentsNode = Node.create({
  addNodeView() {
    return ReactNodeViewRenderer(ContentsView);
  },
  atom: true,
  group: "block",
  name: EDITOR_NODE.tableOfContents,
  parseHTML() {
    return [{ tag: "nav[data-table-of-contents]" }];
  },
  renderHTML() {
    return ["nav", { "data-table-of-contents": "" }];
  },
  selectable: true,
});
