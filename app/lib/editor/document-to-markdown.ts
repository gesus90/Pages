import {
  EDITOR_MARK,
  EDITOR_NODE,
  readFlagAttribute,
  readNumberAttribute,
  readTextAttribute,
} from "@/app/lib/editor/editor-schema";
import {
  DEFAULT_LIST_MARKERS,
  stringifyMarkdownBlock,
} from "@/app/lib/editor/markdown-processor";

import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type {
  AlignType,
  BlockContent,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  TableCell,
  TableRow,
  Text,
} from "mdast";
import type { ListMarkers } from "@/app/lib/editor/markdown-processor";

/** An inline node together with the marks still to be written around it. */
interface InlineItem {
  readonly node: ProseMirrorNode;
  readonly marks: readonly Mark[];
}

const ALIGNMENTS = ["left", "center", "right"] as const;
const DEPTHS = [1, 2, 3, 4, 5, 6] as const;

function children(node: ProseMirrorNode): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];

  node.forEach((child) => nodes.push(child));

  return nodes;
}

function literal(value: string): PhrasingContent {
  return { type: "markdownLiteral", value };
}

function isWrappable(mark: Mark): boolean {
  return mark.type.name !== EDITOR_MARK.code;
}

function runEnd(
  items: readonly InlineItem[],
  start: number,
  mark: Mark,
): number {
  const offset = items
    .slice(start)
    .findIndex((item) => !item.marks.some((other) => other.eq(mark)));

  return offset < 0 ? items.length : start + offset;
}

/** Picks the mark around an item that spans the longest run of items. */
function pickOuterMark(
  items: readonly InlineItem[],
  start: number,
): Mark | null {
  const item: InlineItem = items[start];
  let best: Mark | null = null;
  let bestEnd = start;

  for (const mark of item.marks.filter(isWrappable)) {
    const end = runEnd(items, start, mark);

    if (end > bestEnd) {
      best = mark;
      bestEnd = end;
    }
  }

  return best;
}

function leaf(item: InlineItem): PhrasingContent[] {
  const { node } = item;

  switch (node.type.name) {
    case EDITOR_NODE.text:
      return item.marks.some((mark) => mark.type.name === EDITOR_MARK.code)
        ? [{ type: "inlineCode", value: node.textContent }]
        : [{ type: "text", value: node.textContent }];
    case EDITOR_NODE.hardBreak:
      return [{ type: "break" }];
    case EDITOR_NODE.image:
      return [
        {
          alt: readTextAttribute(node.attrs, "alt") ?? "",
          title: readTextAttribute(node.attrs, "title"),
          type: "image",
          url: readTextAttribute(node.attrs, "src") ?? "",
        },
      ];
    default:
      return node.textContent === ""
        ? []
        : [{ type: "text", value: node.textContent }];
  }
}

function leadingBlank(node: PhrasingContent | undefined): string {
  return node?.type === "text" ? (/^\s+/.exec(node.value)?.[0] ?? "") : "";
}

function trailingBlank(node: PhrasingContent | undefined): string {
  return node?.type === "text" ? (/\s+$/.exec(node.value)?.[0] ?? "") : "";
}

function blankText(value: string): PhrasingContent[] {
  return value === "" ? [] : [{ type: "text", value }];
}

/** Replaces the text of a text node; drops it when nothing is left. */
function replaceText(
  content: PhrasingContent[],
  index: number,
  node: Text,
  value: string,
): void {
  if (value === "") {
    content.splice(index, 1);
  } else {
    content[index] = { ...node, value };
  }
}

/**
 * Moves blanks at the edges of emphasis out of it: `** a**` is no emphasis
 * in markdown, `**a**` behind a blank is.
 */
function moveEdgeBlanks(
  inner: readonly PhrasingContent[],
  wrap: (content: PhrasingContent[]) => PhrasingContent,
): PhrasingContent[] {
  const content = [...inner];
  const lead = leadingBlank(content[0]);
  const first = content[0];

  if (first?.type === "text") {
    replaceText(content, 0, first, first.value.slice(lead.length));
  }

  const trail = trailingBlank(content.at(-1));
  const last = content.at(-1);

  if (last?.type === "text") {
    replaceText(
      content,
      content.length - 1,
      last,
      last.value.slice(0, last.value.length - trail.length),
    );
  }

  return [
    ...blankText(lead),
    ...(content.length === 0 ? [] : [wrap(content)]),
    ...blankText(trail),
  ];
}

function wrapInMark(
  mark: Mark,
  inner: readonly PhrasingContent[],
): PhrasingContent[] {
  switch (mark.type.name) {
    case EDITOR_MARK.bold:
      return moveEdgeBlanks(inner, (content) => ({
        children: content,
        type: "strong",
      }));
    case EDITOR_MARK.italic:
      return moveEdgeBlanks(inner, (content) => ({
        children: content,
        type: "emphasis",
      }));
    case EDITOR_MARK.strike:
      return moveEdgeBlanks(inner, (content) => ({
        children: content,
        type: "delete",
      }));
    case EDITOR_MARK.link:
      return [
        {
          children: [...inner],
          title: readTextAttribute(mark.attrs, "title"),
          type: "link",
          url: readTextAttribute(mark.attrs, "href") ?? "",
        },
      ];
    default:
      return [...inner];
  }
}

function buildPhrasing(items: readonly InlineItem[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let index = 0;

  while (index < items.length) {
    const mark = pickOuterMark(items, index);

    if (mark === null) {
      result.push(...items.slice(index, index + 1).flatMap(leaf));
      index += 1;
      continue;
    }

    const end = runEnd(items, index, mark);
    const inner = items.slice(index, end).map((item) => ({
      marks: item.marks.filter((other) => !other.eq(mark)),
      node: item.node,
    }));

    result.push(...wrapInMark(mark, buildPhrasing(inner)));
    index = end;
  }

  return result;
}

/** Drops blanks at the start and end of a text block; markdown ignores them. */
function trimEdges(content: PhrasingContent[]): PhrasingContent[] {
  const first = content[0];

  if (first?.type === "text") {
    content[0] = { ...first, value: first.value.trimStart() };
  }

  const last = content.at(-1);

  if (last?.type === "text") {
    content[content.length - 1] = { ...last, value: last.value.trimEnd() };
  }

  return content.filter((child) => child.type !== "text" || child.value !== "");
}

/**
 * Writes the inline content of a text block as markdown phrasing.
 *
 * @param block - A paragraph, heading, table cell paragraph or summary.
 * @returns The phrasing nodes, with marks nested as markdown needs them.
 */
export function toPhrasing(block: ProseMirrorNode): PhrasingContent[] {
  return trimEdges(
    buildPhrasing(children(block).map((node) => ({ marks: node.marks, node }))),
  );
}

function toParagraph(node: ProseMirrorNode): Paragraph | null {
  const content = toPhrasing(node);

  return content.length === 0 ? null : { children: content, type: "paragraph" };
}

function toBlocks(node: ProseMirrorNode): BlockContent[] {
  return children(node).flatMap((child) => {
    const block = toMarkdownNode(child);

    return block === null ? [] : [block];
  });
}

function toListItem(item: ProseMirrorNode, spread: boolean): ListItem {
  const isTask = item.type.name === EDITOR_NODE.taskItem;
  const checked = readFlagAttribute(item.attrs, "checked");
  const content = toBlocks(item);

  if (isTask && content.length === 0) {
    return {
      checked: null,
      children: [
        { children: [literal(checked ? "[x]" : "[ ]")], type: "paragraph" },
      ],
      spread,
      type: "listItem",
    };
  }

  return {
    checked: isTask ? checked : null,
    children: content,
    spread,
    type: "listItem",
  };
}

function toList(node: ProseMirrorNode): BlockContent {
  const spread = readFlagAttribute(node.attrs, "spread");
  const isOrdered = node.type.name === EDITOR_NODE.orderedList;

  return {
    children: children(node).map((item) => toListItem(item, spread)),
    ordered: isOrdered,
    spread,
    start: isOrdered ? readNumberAttribute(node.attrs, "start", 1) : null,
    type: "list",
  };
}

function toCallout(node: ProseMirrorNode): BlockContent {
  const kind = (readTextAttribute(node.attrs, "kind") ?? "note").toUpperCase();
  const marker = literal(`[!${kind}]`);
  const [first, ...rest] = toBlocks(node);

  if (first?.type === "paragraph") {
    return {
      children: [
        {
          children: [marker, { type: "text", value: "\n" }, ...first.children],
          type: "paragraph",
        },
        ...rest,
      ],
      type: "blockquote",
    };
  }

  return {
    children: [
      { children: [marker], type: "paragraph" },
      ...(first ? [first, ...rest] : []),
    ],
    type: "blockquote",
  };
}

function toToggle(node: ProseMirrorNode): BlockContent {
  // The schema starts every toggle with its summary.
  const [summary, ...body] = children(node);
  const title = summary.textContent.replace(/\s+/g, " ").trim();
  const head: PhrasingContent[] = [
    literal("[!TOGGLE]"),
    ...(title === ""
      ? []
      : [{ type: "text", value: ` ${title}` } satisfies PhrasingContent]),
  ];

  return {
    children: [
      { children: head, type: "paragraph" },
      ...body.flatMap((child) => {
        const block = toMarkdownNode(child);

        return block === null ? [] : [block];
      }),
    ],
    type: "blockquote",
  };
}

function toTableCell(cell: ProseMirrorNode): TableCell[] {
  const span = readNumberAttribute(cell.attrs, "colspan", 1);
  // A cell holds exactly one paragraph, as a GFM cell holds one line.
  const content = children(cell).flatMap(toPhrasing);

  return [
    { children: content, type: "tableCell" },
    ...Array.from({ length: Math.max(0, span - 1) }, (): TableCell => ({
      children: [],
      type: "tableCell",
    })),
  ];
}

function readAlignment(cell: ProseMirrorNode): AlignType {
  const align = readTextAttribute(cell.attrs, "align");

  return ALIGNMENTS.find((known) => known === align) ?? null;
}

function toTable(node: ProseMirrorNode): BlockContent {
  const rows = children(node);
  // The schema gives every table a first row, which markdown makes the header.
  const header = children(node.child(0));

  return {
    align: header.flatMap((cell) =>
      Array.from(
        { length: readNumberAttribute(cell.attrs, "colspan", 1) },
        () => readAlignment(cell),
      ),
    ),
    children: rows.map((row): TableRow => ({
      children: children(row).flatMap(toTableCell),
      type: "tableRow",
    })),
    type: "table",
  };
}

function toDepth(level: number): (typeof DEPTHS)[number] {
  return DEPTHS.find((depth) => depth === level) ?? 1;
}

function toMarkdownNode(node: ProseMirrorNode): BlockContent | null {
  switch (node.type.name) {
    case EDITOR_NODE.paragraph:
      return toParagraph(node);
    case EDITOR_NODE.heading:
      return {
        children: toPhrasing(node),
        depth: toDepth(readNumberAttribute(node.attrs, "level", 1)),
        type: "heading",
      };
    case EDITOR_NODE.blockquote:
      return { children: toBlocks(node), type: "blockquote" };
    case EDITOR_NODE.callout:
      return toCallout(node);
    case EDITOR_NODE.toggle:
      return toToggle(node);
    case EDITOR_NODE.bulletList:
    case EDITOR_NODE.orderedList:
    case EDITOR_NODE.taskList:
      return toList(node);
    case EDITOR_NODE.codeBlock:
      return {
        lang: readTextAttribute(node.attrs, "language"),
        meta: readTextAttribute(node.attrs, "meta"),
        type: "code",
        value: node.textContent,
      };
    case EDITOR_NODE.horizontalRule:
      return { type: "thematicBreak" };
    case EDITOR_NODE.table:
      return toTable(node);
    case EDITOR_NODE.tableOfContents:
      return { children: [literal("[toc]")], type: "paragraph" };
    default:
      return toParagraph(node);
  }
}

/**
 * Writes one top-level block of the editor as markdown.
 *
 * @param node - A block of the document.
 * @param markers - List markers to use for this block.
 * @returns The markdown, or an empty text for an empty paragraph.
 *
 * @remarks
 * A source block is written as it is. A block with an anchor gets the
 * anchor comment on the line before it.
 */
export function serializeEditorBlock(
  node: ProseMirrorNode,
  markers: ListMarkers = DEFAULT_LIST_MARKERS,
): string {
  if (node.type.name === EDITOR_NODE.rawMarkdown) {
    return node.textContent;
  }

  const block: RootContent | null = toMarkdownNode(node);
  const markdown = block === null ? "" : stringifyMarkdownBlock(block, markers);
  const anchor = readTextAttribute(node.attrs, "blockId");

  return anchor === null || markdown === ""
    ? markdown
    : `<!-- block:${anchor} -->\n${markdown}`;
}
