import { Fragment, Slice } from "@tiptap/pm/model";

import { serializeEditorBlock } from "@/app/lib/editor/document-to-markdown";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";
import {
  ALTERNATE_LIST_MARKERS,
  DEFAULT_LIST_MARKERS,
} from "@/app/lib/editor/markdown-processor";
import {
  createRawBlock,
  parseEditorMarkdown,
} from "@/app/lib/editor/markdown-to-document";

import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import type { ListMarkers } from "@/app/lib/editor/markdown-processor";
import type {
  EditorJsonNode,
  ParsedBlock,
} from "@/app/lib/editor/markdown-to-document";

/** Markdown read for the editor: the content and where each block came from. */
export interface EditorMarkdown {
  readonly source: string;
  /** The document as data, for the `content` of the editor. */
  readonly content: EditorJsonNode;
  /** The top-level blocks in document order. */
  readonly blocks: readonly ParsedBlock[];
}

/** A block of the loaded markdown: its node and where its text was. */
interface BaselineBlock {
  readonly node: ProseMirrorNode;
  readonly start: number;
  readonly end: number;
}

/**
 * The markdown a document was loaded from, so that unchanged blocks are
 * written back exactly as they were.
 */
export interface MarkdownBaseline {
  readonly source: string;
  readonly blocks: readonly BaselineBlock[];
  /** What followed the last block: the end of the text keeps it. */
  readonly trailing: string;
}

/** Which list a block is, so two neighbouring lists keep apart. */
type ListFamily = "bullet" | "ordered" | null;

/** What the next block must know about the block written before it. */
interface WrittenBlock {
  readonly family: ListFamily;
  /** The list marker the block uses: `-`, `*`, `+`, `.` or `)`. */
  readonly marker: string | null;
  /** Index of the block in the baseline when it was written unchanged. */
  readonly original: number | null;
}

// Documents are immutable trees, so the markdown of a block stays valid as
// long as the very same node object exists.
const normalizedCache = new WeakMap<ProseMirrorNode, string>();

function familyOf(node: ProseMirrorNode): ListFamily {
  switch (node.type.name) {
    case EDITOR_NODE.bulletList:
    case EDITOR_NODE.taskList:
      return "bullet";
    case EDITOR_NODE.orderedList:
      return "ordered";
    default:
      return null;
  }
}

function readMarker(markdown: string, family: ListFamily): string | null {
  if (family === "bullet") {
    return /^\s*([-*+])/.exec(markdown)?.[1] ?? null;
  }

  return family === "ordered"
    ? (/^\s*\d+([.)])/.exec(markdown)?.[1] ?? null)
    : null;
}

function normalize(node: ProseMirrorNode): string {
  const cached = normalizedCache.get(node);

  if (cached !== undefined) {
    return cached;
  }

  const markdown = serializeEditorBlock(node);

  normalizedCache.set(node, markdown);

  return markdown;
}

function markersAfter(previous: WrittenBlock | null): ListMarkers {
  return previous?.marker === DEFAULT_LIST_MARKERS.bullet ||
    previous?.marker === DEFAULT_LIST_MARKERS.ordered
    ? ALTERNATE_LIST_MARKERS
    : DEFAULT_LIST_MARKERS;
}

function topLevelBlocks(doc: ProseMirrorNode): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = [];

  doc.forEach((block) => blocks.push(block));

  return blocks;
}

function blockKey(node: ProseMirrorNode): string {
  return `${node.type.name}:${node.childCount}:${node.textContent.length}`;
}

/** Validates a parsed block against the schema; a misfit stays source. */
function toValidBlock(
  block: ParsedBlock,
  source: string,
  schema: Schema,
): ParsedBlock {
  try {
    schema.nodeFromJSON(block.node).check();

    return block;
  } catch (error: unknown) {
    console.warn("A markdown block did not fit the editor schema.", error);

    return {
      ...block,
      node: createRawBlock(source.slice(block.start, block.end)),
    };
  }
}

/**
 * Reads markdown into editor content.
 *
 * @param source - Markdown text.
 * @param schema - Schema of the editor; every block is checked against it.
 * @returns The content and the places of its blocks.
 *
 * @remarks
 * A block that does not fit the schema is kept as a source block, so a
 * mistake in the conversion can never lose text.
 */
export function readMarkdown(source: string, schema: Schema): EditorMarkdown {
  const blocks = parseEditorMarkdown(source).blocks.map((block) =>
    toValidBlock(block, source, schema),
  );

  return {
    blocks,
    content: {
      content:
        blocks.length === 0
          ? [{ type: EDITOR_NODE.paragraph }]
          : blocks.map((block) => block.node),
      type: EDITOR_NODE.doc,
    },
    source,
  };
}

/**
 * Remembers the loaded state of a document.
 *
 * @param markdown - The markdown the document was loaded from.
 * @param doc - The document right after loading.
 * @returns The baseline for {@link serializeMarkdown}.
 */
export function createBaseline(
  markdown: EditorMarkdown,
  doc: ProseMirrorNode,
): MarkdownBaseline {
  const nodes = topLevelBlocks(doc);
  const last = markdown.blocks.at(-1);

  return {
    blocks: markdown.blocks.flatMap((block, index) => {
      const node = nodes[index];

      return node ? [{ end: block.end, node, start: block.start }] : [];
    }),
    source: markdown.source,
    trailing: last ? markdown.source.slice(last.end) : "\n",
  };
}

/** Finds blocks of the baseline that are unchanged, by node equality. */
class BaselineIndex {
  private readonly unused = new Map<string, number[]>();
  private readonly baseline: MarkdownBaseline;

  public constructor(baseline: MarkdownBaseline) {
    this.baseline = baseline;
    baseline.blocks.forEach((block, index) => {
      const key = blockKey(block.node);

      this.unused.set(key, [...(this.unused.get(key) ?? []), index]);
    });
  }

  /**
   * Takes the first unused baseline block that equals a node.
   *
   * @param node - A block of the current document.
   * @returns Its index in the baseline, or `null` when it changed.
   */
  public take(node: ProseMirrorNode): number | null {
    const candidates = this.unused.get(blockKey(node)) ?? [];
    const position = candidates.findIndex((index) =>
      this.baseline.blocks[index]?.node.eq(node),
    );

    if (position < 0) {
      return null;
    }

    const [index] = candidates.splice(position, 1);

    return index;
  }
}

function writeBlock(
  node: ProseMirrorNode,
  base: MarkdownBaseline,
  original: number | null,
  previous: WrittenBlock | null,
): WrittenBlock & { readonly markdown: string } {
  const family = familyOf(node);
  const block = original === null ? null : base.blocks[original];
  const markdown = block
    ? base.source.slice(block.start, block.end)
    : normalize(node);
  const marker = readMarker(markdown, family);
  const collides =
    family !== null &&
    previous?.family === family &&
    previous.marker === marker;

  if (!collides) {
    return { family, markdown, marker, original };
  }

  const rewritten = serializeEditorBlock(node, markersAfter(previous));

  return {
    family,
    markdown: rewritten,
    marker: readMarker(rewritten, family),
    original: null,
  };
}

function joinBefore(
  base: MarkdownBaseline,
  previous: WrittenBlock | null,
  current: number | null,
): string {
  if (previous === null) {
    return current === 0 ? base.source.slice(0, base.blocks[0]?.start) : "";
  }

  const before = previous.original;

  if (before !== null && current === before + 1) {
    return base.source.slice(
      base.blocks[before]?.end,
      base.blocks[current]?.start,
    );
  }

  return "\n\n";
}

/**
 * Writes the document as markdown.
 *
 * @param doc - The editor document.
 * @param baseline - The state the document was loaded in, if any.
 * @returns The markdown text of the document.
 *
 * @remarks
 * Every block that still equals its loaded state is written exactly as it
 * was, with the spacing it had to its former neighbour, so opening and
 * saving a page never rewrites text nobody touched; the end of the text
 * stays as it was. Empty paragraphs are dropped, and neighbouring lists of
 * the same kind get different markers so that markdown does not merge them.
 */
export function serializeMarkdown(
  doc: ProseMirrorNode,
  baseline: MarkdownBaseline | null,
): string {
  const base = baseline ?? { blocks: [], source: "", trailing: "\n" };
  const index = new BaselineIndex(base);
  let output = "";
  let previous: WrittenBlock | null = null;

  for (const node of topLevelBlocks(doc)) {
    const original = index.take(node);

    if (original === null && normalize(node) === "") {
      continue;
    }

    const written = writeBlock(node, base, original, previous);

    output += joinBefore(base, previous, written.original) + written.markdown;
    previous = written;
  }

  return output === "" ? "" : output + base.trailing;
}

/**
 * Writes a copied part of the document as markdown, for the clipboard.
 *
 * @param fragment - The copied blocks.
 * @returns Markdown of the blocks, separated by blank lines.
 */
export function serializeMarkdownFragment(fragment: Fragment): string {
  const blocks: string[] = [];

  fragment.forEach((node) => {
    const markdown = node.isBlock
      ? serializeEditorBlock(node)
      : node.textContent;

    if (markdown !== "") {
      blocks.push(markdown);
    }
  });

  return blocks.join("\n\n");
}

/**
 * Reads pasted markdown into a slice of the document.
 *
 * @param text - The pasted text.
 * @param schema - Schema of the editor.
 * @returns A slice that keeps the structure of the markdown; a single
 * paragraph is open on both sides, so it joins the paragraph it lands in.
 */
export function parseMarkdownSlice(text: string, schema: Schema): Slice {
  const nodes = readMarkdown(text, schema).blocks.map((block) =>
    schema.nodeFromJSON(block.node),
  );
  const [only] = nodes;

  if (nodes.length === 1 && only?.type.name === EDITOR_NODE.paragraph) {
    return new Slice(Fragment.from(only), 1, 1);
  }

  return new Slice(Fragment.fromArray(nodes), 0, 0);
}
