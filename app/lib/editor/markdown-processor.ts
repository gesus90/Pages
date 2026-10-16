import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import type { Literal, Root, RootContent, Text } from "mdast";
import type { Options as StringifyOptions } from "remark-stringify";

/**
 * Text written to the markdown exactly as it is, without escaping: the
 * markers of callouts, toggles and the table of contents.
 */
export interface MarkdownLiteral extends Literal {
  readonly type: "markdownLiteral";
}

declare module "mdast" {
  interface PhrasingContentMap {
    markdownLiteral: MarkdownLiteral;
  }

  interface RootContentMap {
    markdownLiteral: MarkdownLiteral;
  }
}

/**
 * How plain text is written: `escaped` so that no character of it reads as
 * markdown, or `typed` exactly as the person typed it, as in a chat message.
 */
export type MarkdownTextStyle = "escaped" | "typed";

/** How list markers of one block are written. */
export interface ListMarkers {
  /** Marker of bullet lists. */
  readonly bullet: "-" | "*";
  /** Marker after the number of ordered lists. */
  readonly ordered: "." | ")";
}

/** Markers of lists that do not follow another list of the same kind. */
export const DEFAULT_LIST_MARKERS: ListMarkers = { bullet: "-", ordered: "." };

/** Markers of a list right after a list of the same kind, so both stay apart. */
export const ALTERNATE_LIST_MARKERS: ListMarkers = {
  bullet: "*",
  ordered: ")",
};

// The editor writes the same markdown as the former source editor: `_`
// for emphasis, `**` for strong text, fenced code and `-` for rules.
const STRINGIFY_OPTIONS = {
  emphasis: "_",
  fences: true,
  handlers: { markdownLiteral: (node: MarkdownLiteral) => node.value },
  listItemIndent: "one",
  rule: "-",
  strong: "*",
} satisfies StringifyOptions;

type TextHandler = NonNullable<
  NonNullable<StringifyOptions["handlers"]>["text"]
>;
type Stringify = (tree: Root) => string;

const writeTypedText: TextHandler = (node: Text, parent, state, info) => {
  const isInside = (construct: string): boolean =>
    state.stack.some((entered) => entered === construct);

  // A bracket would end a link label and a bar a table cell, so these stay
  // escaped there.
  if (isInside("label")) {
    return state.safe(node.value, info);
  }

  return isInside("tableCell") ? node.value.replaceAll("|", "\\|") : node.value;
};

function createStringifier(
  markers: ListMarkers,
  textStyle: MarkdownTextStyle,
): Stringify {
  const processor = unified()
    .use(remarkGfm)
    .use(remarkStringify, {
      ...STRINGIFY_OPTIONS,
      bullet: markers.bullet,
      bulletOrdered: markers.ordered,
      handlers:
        textStyle === "typed"
          ? { ...STRINGIFY_OPTIONS.handlers, text: writeTypedText }
          : STRINGIFY_OPTIONS.handlers,
    });

  return (tree) => processor.stringify(tree);
}

const parser = unified().use(remarkParse).use(remarkGfm);
const stringifiers: Readonly<
  Record<
    MarkdownTextStyle,
    { readonly regular: Stringify; readonly alternate: Stringify }
  >
> = {
  escaped: {
    regular: createStringifier(DEFAULT_LIST_MARKERS, "escaped"),
    alternate: createStringifier(ALTERNATE_LIST_MARKERS, "escaped"),
  },
  typed: {
    regular: createStringifier(DEFAULT_LIST_MARKERS, "typed"),
    alternate: createStringifier(ALTERNATE_LIST_MARKERS, "typed"),
  },
};

/**
 * Parses markdown the way the wiki renderer reads it (CommonMark and GFM).
 *
 * @param source - Markdown text.
 * @returns The syntax tree with source positions.
 */
export function parseMarkdownTree(source: string): Root {
  return parser.parse(source);
}

/**
 * Writes one block of a syntax tree as markdown.
 *
 * @param block - A top-level block.
 * @param markers - List markers to use for this block.
 * @param textStyle - Whether plain text is escaped or written as typed.
 * @returns The markdown without the final line break.
 */
export function stringifyMarkdownBlock(
  block: RootContent,
  markers: ListMarkers = DEFAULT_LIST_MARKERS,
  textStyle: MarkdownTextStyle = "escaped",
): string {
  const { regular, alternate } = stringifiers[textStyle];
  const stringify = markers === ALTERNATE_LIST_MARKERS ? alternate : regular;

  return stringify({ children: [block], type: "root" }).replace(/\n$/, "");
}
