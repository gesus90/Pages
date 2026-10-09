/** The parts of a markdown syntax tree node that the wiki plugin reads. */
interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string>;
  };
}

const MARKER_PATTERN = /^\[!([A-Za-z]+)\][ \t]*/;
const TOC_PATTERN = /^\[toc\]$/i;

/**
 * The comment that names the block after it, so that a link can point to
 * that block (`/wiki/<page>#block-<id>`).
 */
export const BLOCK_ANCHOR_PATTERN = /^<!--\s*block:([a-z0-9]{1,32})\s*-->$/;

/** Callout kinds the renderer knows; anything else stays a plain quote. */
export const WIKI_CALLOUT_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

/** The kind of a callout block. */
export type WikiCalloutKind = (typeof WIKI_CALLOUT_KINDS)[number];

function isCalloutKind(kind: string): kind is WikiCalloutKind {
  return WIKI_CALLOUT_KINDS.some((known) => known === kind);
}

/** The leading text of a quote and whether it is all of its first paragraph. */
interface LeadingText {
  readonly text: MarkdownNode;
  readonly isAlone: boolean;
}

/** Finds the leading text of a quote: its first paragraph's first text. */
function findLeadingText(
  children: readonly MarkdownNode[],
): LeadingText | undefined {
  const [paragraph] = children;
  const inline =
    paragraph?.type === "paragraph" ? (paragraph.children ?? []) : [];
  const [text] = inline;

  return text?.type === "text"
    ? { isAlone: inline.length === 1, text }
    : undefined;
}

/** Turns a quote that starts with `[!TOGGLE] Title` into a details block. */
function convertToggle(
  quote: MarkdownNode,
  children: readonly MarkdownNode[],
  leading: LeadingText,
  value: string,
): void {
  const { text } = leading;
  const rest = value.replace(MARKER_PATTERN, "");
  const lineEnd = rest.indexOf("\n");
  const title = lineEnd < 0 ? rest : rest.slice(0, lineEnd);

  text.value = lineEnd < 0 ? "" : rest.slice(lineEnd + 1);
  quote.data = { hName: "details" };

  // A paragraph that only held the title would render as an empty line.
  const [, ...others] = children;
  const isFirstEmpty = text.value === "" && leading.isAlone;

  quote.children = [
    {
      children: [{ type: "text", value: title }],
      data: { hName: "summary" },
      type: "paragraph",
    },
    ...(isFirstEmpty ? others : children),
  ];
}

/** Turns a quote that starts with `[!NOTE]` and the like into a callout. */
function convertQuote(quote: MarkdownNode): void {
  const children = quote.children ?? [];
  const leading = findLeadingText(children);
  const value = leading?.text.value ?? "";
  const kind = MARKER_PATTERN.exec(value)?.[1]?.toLowerCase() ?? "";

  if (!leading) {
    return;
  }

  if (kind === "toggle") {
    convertToggle(quote, children, leading, value);
  } else if (isCalloutKind(kind)) {
    leading.text.value = value.replace(MARKER_PATTERN, "").replace(/^\n/, "");
    quote.data = { hProperties: { "data-wiki-callout": kind } };
  }
}

/** Turns a paragraph that holds only `[toc]` into the contents marker. */
function convertContents(paragraph: MarkdownNode): void {
  const [only, ...others] = paragraph.children ?? [];

  if (others.length === 0 && TOC_PATTERN.test(only?.value?.trim() ?? "")) {
    paragraph.data = { hName: "nav", hProperties: { "data-wiki-toc": "true" } };
    paragraph.children = [];
  }
}

/** Turns a block anchor comment into an empty element with that anchor. */
function convertAnchor(html: MarkdownNode): void {
  const id = BLOCK_ANCHOR_PATTERN.exec(html.value?.trim() ?? "")?.[1];

  if (id === undefined) {
    return;
  }

  html.type = "paragraph";
  html.value = undefined;
  html.children = [];
  html.data = {
    hName: "span",
    hProperties: { className: "block scroll-mt-20", id: `block-${id}` },
  };
}

function visit(node: MarkdownNode): void {
  if (node.type === "blockquote") {
    convertQuote(node);
  } else if (node.type === "paragraph") {
    convertContents(node);
  } else if (node.type === "html") {
    convertAnchor(node);
  }

  node.children?.forEach(visit);
}

/**
 * Remark plugin for the extra blocks of wiki pages.
 *
 * @returns A transformer that rewrites the syntax tree: `> [!NOTE]` and the
 * other kinds of {@link WIKI_CALLOUT_KINDS} become callouts, `> [!TOGGLE]
 * Title` a collapsible block, a paragraph with only `[toc]` a marker for
 * the table of contents, and a block anchor comment an empty element that
 * carries the anchor of the block after it.
 *
 * @remarks
 * The plugin only sets element names and fixed attributes; text from the page
 * never becomes markup, so raw HTML stays impossible.
 */
export function remarkWikiBlocks(): (tree: MarkdownNode) => void {
  return (tree) => {
    visit(tree);
  };
}
