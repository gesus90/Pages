import {
  ANCHORABLE_NODES,
  EDITOR_MARK,
  EDITOR_NODE,
} from "@/app/lib/editor/editor-schema";
import { parseMarkdownTree } from "@/app/lib/editor/markdown-processor";
import {
  BLOCK_ANCHOR_PATTERN,
  WIKI_CALLOUT_KINDS,
} from "@/app/lib/wiki-remark";

import type {
  Blockquote,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";
import type { EditorAttributes } from "@/app/lib/editor/editor-schema";

/** A mark of the editor document as plain data. */
export interface EditorJsonMark {
  readonly type: string;
  readonly attrs?: EditorAttributes;
}

/** A node of the editor document as plain data, as Tiptap loads it. */
export interface EditorJsonNode {
  readonly type: string;
  readonly attrs?: EditorAttributes;
  readonly content?: EditorJsonNode[];
  readonly marks?: EditorJsonMark[];
  readonly text?: string;
}

/** A top-level block together with the place of its markdown. */
export interface ParsedBlock {
  readonly node: EditorJsonNode;
  /** Offset of the first character of the block in the markdown. */
  readonly start: number;
  /** Offset after the last character of the block. */
  readonly end: number;
}

/** Markdown read into editor blocks. */
export interface ParsedMarkdown {
  readonly source: string;
  readonly blocks: readonly ParsedBlock[];
}

/** Marker of a callout or toggle at the start of a quote (renderer rule). */
const QUOTE_MARKER = /^\[!([A-Za-z]+)\][ \t]*/;
const CONTENTS_MARKER = /^\[toc\]$/i;
const EMPTY_TASK = /^\[( |x|X)\]$/;

/** Marks of the editor for the emphasis nodes of markdown. */
const EMPHASIS_MARKS: Readonly<Record<string, string>> = {
  delete: EDITOR_MARK.strike,
  emphasis: EDITOR_MARK.italic,
  strong: EDITOR_MARK.bold,
};

/** Thrown for markdown the editor cannot show as blocks; it stays source. */
class UnsupportedMarkdownError extends Error {
  public constructor(type: string) {
    super(`The editor shows "${type}" as markdown source.`);
    this.name = "UnsupportedMarkdownError";
  }
}

function isCalloutKind(kind: string): boolean {
  return WIKI_CALLOUT_KINDS.some((known) => known === kind);
}

function textNode(
  text: string,
  marks: readonly EditorJsonMark[],
): EditorJsonNode {
  return marks.length === 0
    ? { text, type: EDITOR_NODE.text }
    : { marks: [...marks], text, type: EDITOR_NODE.text };
}

function addMark(
  marks: readonly EditorJsonMark[],
  mark: EditorJsonMark,
): readonly EditorJsonMark[] {
  return marks.some((existing) => existing.type === mark.type)
    ? marks
    : [...marks, mark];
}

function paragraph(content: readonly EditorJsonNode[]): EditorJsonNode {
  return content.length === 0
    ? { type: EDITOR_NODE.paragraph }
    : { content: [...content], type: EDITOR_NODE.paragraph };
}

function convertInline(
  nodes: readonly PhrasingContent[],
  marks: readonly EditorJsonMark[],
): EditorJsonNode[] {
  return nodes.flatMap((node) => convertPhrasing(node, marks));
}

function convertPhrasing(
  node: PhrasingContent,
  marks: readonly EditorJsonMark[],
): EditorJsonNode[] {
  if (node.type === "text") {
    return node.value === "" ? [] : [textNode(node.value, marks)];
  }

  if (node.type === "inlineCode") {
    return [textNode(node.value, addMark(marks, { type: EDITOR_MARK.code }))];
  }

  if (node.type === "break") {
    return [{ type: EDITOR_NODE.hardBreak }];
  }

  if (node.type === "image") {
    return [convertImage(node, marks)];
  }

  if (node.type === "link") {
    return convertInline(
      node.children,
      addMark(marks, {
        attrs: { href: node.url, title: node.title ?? null },
        type: EDITOR_MARK.link,
      }),
    );
  }

  const mark = EMPHASIS_MARKS[node.type];

  if (mark !== undefined && "children" in node) {
    return convertInline(node.children, addMark(marks, { type: mark }));
  }

  throw new UnsupportedMarkdownError(node.type);
}

function convertImage(
  image: {
    readonly url: string;
    readonly alt?: string | null;
    readonly title?: string | null;
  },
  marks: readonly EditorJsonMark[],
): EditorJsonNode {
  const attrs = {
    alt: image.alt ?? "",
    src: image.url,
    title: image.title ?? null,
  };

  return marks.length === 0
    ? { attrs, type: EDITOR_NODE.image }
    : { attrs, marks: [...marks], type: EDITOR_NODE.image };
}

function convertParagraph(node: Paragraph): EditorJsonNode {
  const [only, ...others] = node.children;

  if (
    others.length === 0 &&
    only?.type === "text" &&
    CONTENTS_MARKER.test(only.value.trim())
  ) {
    return { type: EDITOR_NODE.tableOfContents };
  }

  return paragraph(convertInline(node.children, []));
}

function convertBlocks(nodes: readonly RootContent[]): EditorJsonNode[] {
  return nodes.map(convertBlock);
}

/** Converts the content of a container that needs at least one block. */
function convertContainerBlocks(
  nodes: readonly RootContent[],
): EditorJsonNode[] {
  return withFallbackParagraph(convertBlocks(nodes));
}

function withFallbackParagraph(
  blocks: readonly EditorJsonNode[],
): EditorJsonNode[] {
  return blocks.length === 0 ? [paragraph([])] : [...blocks];
}

function convertBlock(node: RootContent): EditorJsonNode {
  if (node.type === "paragraph") {
    return convertParagraph(node);
  }

  if (node.type === "heading") {
    return {
      attrs: { level: node.depth },
      content: convertInline(node.children, []),
      type: EDITOR_NODE.heading,
    };
  }

  if (node.type === "thematicBreak") {
    return { type: EDITOR_NODE.horizontalRule };
  }

  if (node.type === "blockquote") {
    return convertQuote(node);
  }

  if (node.type === "list") {
    return convertList(node);
  }

  if (node.type === "code") {
    return {
      attrs: { language: node.lang ?? null, meta: node.meta ?? null },
      content: node.value === "" ? [] : [textNode(node.value, [])],
      type: EDITOR_NODE.codeBlock,
    };
  }

  if (node.type === "table") {
    return convertTable(node);
  }

  throw new UnsupportedMarkdownError(node.type);
}

/**
 * Converts what follows the marker of a callout or toggle: the rest of the
 * first paragraph, then the other blocks of the quote.
 */
function convertMarkedBody(
  quote: Blockquote,
  first: Paragraph,
  remainingText: string,
): EditorJsonNode[] {
  const rest: PhrasingContent[] = first.children.slice(1);
  const content = convertInline(
    remainingText === ""
      ? rest
      : [{ type: "text", value: remainingText }, ...rest],
    [],
  );

  return [
    ...(content.length === 0 ? [] : [paragraph(content)]),
    ...convertBlocks(quote.children.slice(1)),
  ];
}

function convertToggle(
  quote: Blockquote,
  first: Paragraph,
  value: string,
): EditorJsonNode {
  const rest = value.replace(QUOTE_MARKER, "");
  const lineEnd = rest.indexOf("\n");
  const title = lineEnd < 0 ? rest : rest.slice(0, lineEnd);
  const remaining = lineEnd < 0 ? "" : rest.slice(lineEnd + 1);

  return {
    attrs: { open: false },
    content: [
      {
        content: title === "" ? [] : [textNode(title, [])],
        type: EDITOR_NODE.toggleSummary,
      },
      ...convertMarkedBody(quote, first, remaining),
    ],
    type: EDITOR_NODE.toggle,
  };
}

function convertQuote(quote: Blockquote): EditorJsonNode {
  const [first] = quote.children;
  const lead = first?.type === "paragraph" ? first.children[0] : undefined;

  if (first?.type !== "paragraph" || lead?.type !== "text") {
    return plainQuote(quote);
  }

  const kind = QUOTE_MARKER.exec(lead.value)?.[1]?.toLowerCase() ?? "";

  if (kind === "toggle") {
    return convertToggle(quote, first, lead.value);
  }

  if (!isCalloutKind(kind)) {
    return plainQuote(quote);
  }

  const remaining = lead.value.replace(QUOTE_MARKER, "").replace(/^\n/, "");

  return {
    attrs: { kind },
    content: withFallbackParagraph(convertMarkedBody(quote, first, remaining)),
    type: EDITOR_NODE.callout,
  };
}

function plainQuote(quote: Blockquote): EditorJsonNode {
  return {
    content: convertContainerBlocks(quote.children),
    type: EDITOR_NODE.blockquote,
  };
}

/** The checkbox of an item: a GFM task, a lone `[ ]` or `[x]`, or none. */
function readTaskState(item: ListItem): boolean | null {
  if (typeof item.checked === "boolean") {
    return item.checked;
  }

  const [only, ...others] = item.children;
  const [text, ...rest] = only?.type === "paragraph" ? only.children : [];

  if (
    others.length > 0 ||
    rest.length > 0 ||
    text?.type !== "text" ||
    !EMPTY_TASK.test(text.value)
  ) {
    return null;
  }

  return text.value !== "[ ]";
}

function convertItemContent(item: ListItem): EditorJsonNode[] {
  if (item.children.length > 0 && item.children[0]?.type !== "paragraph") {
    throw new UnsupportedMarkdownError("listItem");
  }

  return convertContainerBlocks(item.children);
}

function convertTaskList(
  list: List,
  states: readonly boolean[],
): EditorJsonNode {
  return {
    attrs: { spread: list.spread ?? false },
    content: list.children.map((item, index) => ({
      attrs: { checked: states[index] },
      content:
        typeof item.checked === "boolean"
          ? convertItemContent(item)
          : [paragraph([])],
      type: EDITOR_NODE.taskItem,
    })),
    type: EDITOR_NODE.taskList,
  };
}

function convertList(list: List): EditorJsonNode {
  const states = list.children.flatMap((item) => {
    const state = readTaskState(item);

    return state === null ? [] : [state];
  });

  if (!list.ordered && states.length === list.children.length) {
    return convertTaskList(list, states);
  }

  if (list.children.some((item) => typeof item.checked === "boolean")) {
    throw new UnsupportedMarkdownError("mixedTaskList");
  }

  const content = list.children.map((item) => ({
    content: convertItemContent(item),
    type: EDITOR_NODE.listItem,
  }));
  const spread = list.spread ?? false;

  return list.ordered
    ? {
        attrs: { spread, start: list.start ?? 1 },
        content,
        type: EDITOR_NODE.orderedList,
      }
    : { attrs: { spread }, content, type: EDITOR_NODE.bulletList };
}

function convertTable(table: Table): EditorJsonNode {
  const align = table.align ?? [];
  const width = Math.max(...table.children.map((row) => row.children.length));

  return {
    content: table.children.map((row, rowIndex) => ({
      content: Array.from({ length: width }, (_, column) => ({
        attrs: { align: align[column] ?? null },
        content: [
          paragraph(convertInline(row.children[column]?.children ?? [], [])),
        ],
        type: rowIndex === 0 ? EDITOR_NODE.tableHeader : EDITOR_NODE.tableCell,
      })),
      type: EDITOR_NODE.tableRow,
    })),
    type: EDITOR_NODE.table,
  };
}

/**
 * A block that shows its markdown as source.
 *
 * @param text - The markdown, kept character for character.
 * @returns The source block.
 */
export function createRawBlock(text: string): EditorJsonNode {
  return text === ""
    ? { type: EDITOR_NODE.rawMarkdown }
    : { content: [textNode(text, [])], type: EDITOR_NODE.rawMarkdown };
}

function convertTopLevel(node: RootContent, source: string): EditorJsonNode {
  try {
    return convertBlock(node);
  } catch (error: unknown) {
    if (!(error instanceof UnsupportedMarkdownError)) {
      throw error;
    }

    const { start, end } = offsets(node);

    return createRawBlock(source.slice(start, end));
  }
}

function readAnchor(node: RootContent): string | null {
  return node.type === "html"
    ? (BLOCK_ANCHOR_PATTERN.exec(node.value.trim())?.[1] ?? null)
    : null;
}

function offsets(node: RootContent): { start: number; end: number } {
  return {
    end: node.position?.end.offset ?? 0,
    start: node.position?.start.offset ?? 0,
  };
}

/** A block anchor comment waiting for the block it names. */
interface PendingAnchor {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

function anchorAsSource(anchor: PendingAnchor, source: string): ParsedBlock {
  return {
    end: anchor.end,
    node: createRawBlock(source.slice(anchor.start, anchor.end)),
    start: anchor.start,
  };
}

function attachAnchor(
  block: ParsedBlock,
  anchor: PendingAnchor | null,
  source: string,
): ParsedBlock[] {
  if (anchor === null) {
    return [block];
  }

  if (!ANCHORABLE_NODES.includes(block.node.type)) {
    return [anchorAsSource(anchor, source), block];
  }

  return [
    {
      end: block.end,
      node: {
        ...block.node,
        attrs: { ...block.node.attrs, blockId: anchor.id },
      },
      start: anchor.start,
    },
  ];
}

/**
 * Reads markdown into the blocks of the editor.
 *
 * @param source - Markdown text of a page.
 * @returns One editor block per top-level markdown block, each with the
 * place it came from.
 *
 * @remarks
 * The rules follow the wiki renderer, so the editor shows what the page
 * shows: callouts and toggles are marked quotes, `[toc]` is the table of
 * contents, and a lone `[ ]` list item is an empty task. A block anchor
 * comment names the block after it. Anything the editor cannot show as
 * blocks (raw HTML, reference links, footnotes, mixed task lists) becomes a
 * source block that keeps the markdown character for character.
 */
export function parseEditorMarkdown(source: string): ParsedMarkdown {
  const blocks: ParsedBlock[] = [];
  let anchor: PendingAnchor | null = null;

  for (const node of parseMarkdownTree(source).children) {
    const id = readAnchor(node);
    const range = offsets(node);

    if (id !== null) {
      blocks.push(...(anchor === null ? [] : [anchorAsSource(anchor, source)]));
      anchor = { ...range, id };
      continue;
    }

    const block = { ...range, node: convertTopLevel(node, source) };

    blocks.push(...attachAnchor(block, anchor, source));
    anchor = null;
  }

  if (anchor !== null) {
    blocks.push(anchorAsSource(anchor, source));
  }

  return { blocks, source };
}
