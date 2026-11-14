import { Node, mergeAttributes } from "@tiptap/core";

import { readTextAttribute } from "@/app/lib/editor/editor-schema";

/** Inline atom with text content so the shared Markdown serializer retains the handle. */
export const ChatMentionNode = Node.create({
  name: "chatMention",
  group: "inline",
  inline: true,
  atom: true,
  content: "text*",
  selectable: false,
  addAttributes: () => ({ username: { default: "" } }),
  parseHTML: () => [
    {
      tag: "span[data-chat-mention]",
      getAttrs: (element) => ({
        username: element.getAttribute("data-chat-mention") ?? "",
      }),
    },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, {
      "data-chat-mention": readTextAttribute(node.attrs, "username") ?? "",
      contenteditable: "false",
      class: "rounded bg-primary-subtle px-1 font-semibold text-status-active",
    }),
    0,
  ],
  renderText: ({ node }) => node.textContent,
});
