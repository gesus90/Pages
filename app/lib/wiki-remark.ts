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

/** Finds the leading text of a quote: its first paragraph's first text. */
function findLeadingText(
  children: readonly MarkdownNode[],
): MarkdownNode | undefined {
  const [paragraph] = children;
  const [text] =
    paragraph?.type === "paragraph" ? (paragraph.children ?? []) : [];

  return text?.type === "text" ? text : undefined;
}

/** Turns a quote that starts with `[!TOGGLE] Title` into a details block. */
function convertToggle(
  quote: MarkdownNode,
  children: readonly MarkdownNode[],
  text: MarkdownNode,
  value: string,
): void {
  const rest = value.replace(MARKER_PATTERN, "");
  const lineEnd = rest.indexOf("\n");
  const title = lineEnd < 0 ? rest : rest.slice(0, lineEnd);

  text.value = lineEnd < 0 ? "" : rest.slice(lineEnd + 1);
  quote.data = { hName: "details" };
  quote.children = [
    {
      children: [{ type: "text", value: title }],
      data: { hName: "summary" },
      type: "paragraph",
    },
    ...children,
  ];
}

/** Turns a quote that starts with `[!NOTE]` and the like into a callout. */
function convertQuote(quote: MarkdownNode): void {
  const children = quote.children ?? [];
  const text = findLeadingText(children);
  const value = text?.value ?? "";
  const kind = MARKER_PATTERN.exec(value)?.[1]?.toLowerCase() ?? "";

  if (!text) {
    return;
  }

  if (kind === "toggle") {
    convertToggle(quote, children, text, value);
  } else if (isCalloutKind(kind)) {
    text.value = value.replace(MARKER_PATTERN, "").replace(/^\n/, "");
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

function visit(node: MarkdownNode): void {
  if (node.type === "blockquote") {
    convertQuote(node);
  } else if (node.type === "paragraph") {
    convertContents(node);
  }

  node.children?.forEach(visit);
}

/**
 * Remark plugin for the extra blocks of wiki pages.
 *
 * @returns A transformer that rewrites the syntax tree: `> [!NOTE]` and the
 * other kinds of {@link WIKI_CALLOUT_KINDS} become callouts, `> [!TOGGLE]
 * Title` a collapsible block, and a paragraph with only `[toc]` a marker for
 * the table of contents.
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
