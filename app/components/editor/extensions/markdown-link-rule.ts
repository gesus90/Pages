import { Extension, InputRule } from "@tiptap/core";

import { transformMarkdownUrl } from "@/app/lib/markdown-links";
import { EDITOR_MARK } from "@/app/lib/editor/editor-schema";

/** `[text](address)` followed by a blank or the closing parenthesis. */
const MARKDOWN_LINK = /(?:^|\s)\[([^\]\n]+)\]\(([^()\s]+)\)$/;

/**
 * Turns markdown link syntax into a link while typing, as Notion does.
 * Addresses the renderer would refuse stay plain text.
 */
export const MarkdownLinkRule = Extension.create({
  addInputRules() {
    return [
      new InputRule({
        find: MARKDOWN_LINK,
        handler: ({ state, range, match }) => {
          const [whole = "", text = "", href = ""] = match;

          if (transformMarkdownUrl(href) === "") {
            return null;
          }

          const start = range.from + whole.indexOf("[");
          const mark = state.schema.marks[EDITOR_MARK.link].create({ href });

          state.tr.replaceWith(
            start,
            range.to,
            state.schema.text(text, [mark]),
          );

          return undefined;
        },
      }),
    ];
  },
  name: "markdownLinkRule",
});
