import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import type { Literal, Root, RootContent } from "mdast";
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

const parser = unified().use(remarkParse).use(remarkGfm);
const defaultStringifier = unified()
  .use(remarkGfm)
  .use(remarkStringify, {
    ...STRINGIFY_OPTIONS,
    bullet: DEFAULT_LIST_MARKERS.bullet,
    bulletOrdered: DEFAULT_LIST_MARKERS.ordered,
  });
const alternateStringifier = unified()
  .use(remarkGfm)
  .use(remarkStringify, {
    ...STRINGIFY_OPTIONS,
    bullet: ALTERNATE_LIST_MARKERS.bullet,
    bulletOrdered: ALTERNATE_LIST_MARKERS.ordered,
  });

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
 * @returns The markdown without the final line break.
 */
export function stringifyMarkdownBlock(
  block: RootContent,
  markers: ListMarkers = DEFAULT_LIST_MARKERS,
): string {
  const stringifier =
    markers === ALTERNATE_LIST_MARKERS
      ? alternateStringifier
      : defaultStringifier;

  return stringifier
    .stringify({ children: [block], type: "root" })
    .replace(/\n$/, "");
}
